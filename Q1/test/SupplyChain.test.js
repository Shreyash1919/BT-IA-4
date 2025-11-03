const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SupplyChain Contract", function () {
  let supplyChain;
  let admin, manufacturer, distributor, retailer, unauthorized;
  
  // Role enum values
  const Role = {
    NONE: 0,
    MANUFACTURER: 1,
    DISTRIBUTOR: 2,
    RETAILER: 3
  };
  
  // ShipmentStatus enum values
  const ShipmentStatus = {
    CREATED: 0,
    IN_TRANSIT: 1,
    RECEIVED: 2
  };

  beforeEach(async function () {
    // Get signers
    [admin, manufacturer, distributor, retailer, unauthorized] = await ethers.getSigners();
    
    // Deploy contract
    const SupplyChain = await ethers.getContractFactory("SupplyChain");
    supplyChain = await SupplyChain.deploy();
    await supplyChain.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      expect(await supplyChain.admin()).to.equal(admin.address);
    });

    it("Should initialize counters to zero", async function () {
      expect(await supplyChain.productCounter()).to.equal(0);
      expect(await supplyChain.shipmentCounter()).to.equal(0);
    });
  });

  describe("Participant Registration", function () {
    it("Should allow admin to register a manufacturer", async function () {
      await expect(
        supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER)
      ).to.emit(supplyChain, "ParticipantRegistered")
        .withArgs(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);

      const participant = await supplyChain.getParticipant(manufacturer.address);
      expect(participant.name).to.equal("ABC Manufacturing");
      expect(participant.role).to.equal(Role.MANUFACTURER);
      expect(participant.isRegistered).to.be.true;
    });

    it("Should allow admin to register multiple participants", async function () {
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.registerParticipant(distributor.address, "XYZ Distributors", Role.DISTRIBUTOR);
      await supplyChain.registerParticipant(retailer.address, "RetailCo", Role.RETAILER);

      const mfg = await supplyChain.getParticipant(manufacturer.address);
      const dist = await supplyChain.getParticipant(distributor.address);
      const ret = await supplyChain.getParticipant(retailer.address);

      expect(mfg.role).to.equal(Role.MANUFACTURER);
      expect(dist.role).to.equal(Role.DISTRIBUTOR);
      expect(ret.role).to.equal(Role.RETAILER);
    });

    it("Should prevent non-admin from registering participants", async function () {
      await expect(
        supplyChain.connect(manufacturer).registerParticipant(
          distributor.address, 
          "XYZ Distributors", 
          Role.DISTRIBUTOR
        )
      ).to.be.revertedWith("Only admin can perform this action");
    });

    it("Should prevent registering with invalid role", async function () {
      await expect(
        supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.NONE)
      ).to.be.revertedWith("Invalid role");
    });

    it("Should prevent duplicate registration", async function () {
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      
      await expect(
        supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing v2", Role.MANUFACTURER)
      ).to.be.revertedWith("Participant already registered");
    });
  });

  describe("Product Creation", function () {
    beforeEach(async function () {
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.registerParticipant(distributor.address, "XYZ Distributors", Role.DISTRIBUTOR);
    });

    it("Should allow manufacturer to create a product", async function () {
      const tx = await supplyChain.connect(manufacturer).createProduct("Widget A");
      const receipt = await tx.wait();
      
      // Verify ProductCreated event was emitted
      const event = receipt.logs.find(log => {
        try {
          return supplyChain.interface.parseLog(log).name === "ProductCreated";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;

      const product = await supplyChain.connect(manufacturer).getProduct(1);
      expect(product.name).to.equal("Widget A");
      expect(product.manufacturer).to.equal(manufacturer.address);
    });

    it("Should increment product counter", async function () {
      await supplyChain.connect(manufacturer).createProduct("Widget A");
      await supplyChain.connect(manufacturer).createProduct("Widget B");
      
      expect(await supplyChain.getTotalProducts()).to.equal(2);
    });

    it("Should prevent non-manufacturer from creating products", async function () {
      await expect(
        supplyChain.connect(distributor).createProduct("Widget A")
      ).to.be.revertedWith("Unauthorized role");
    });

    it("Should prevent unregistered user from creating products", async function () {
      await expect(
        supplyChain.connect(unauthorized).createProduct("Widget A")
      ).to.be.revertedWith("Participant not registered");
    });

    it("Should prevent creating product with empty name", async function () {
      await expect(
        supplyChain.connect(manufacturer).createProduct("")
      ).to.be.revertedWith("Product name cannot be empty");
    });
  });

  describe("Shipment Creation", function () {
    let productId;

    beforeEach(async function () {
      // Register all participants
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.registerParticipant(distributor.address, "XYZ Distributors", Role.DISTRIBUTOR);
      await supplyChain.registerParticipant(retailer.address, "RetailCo", Role.RETAILER);
      
      // Create a product
      await supplyChain.connect(manufacturer).createProduct("Widget A");
      productId = 1;
    });

    it("Should allow manufacturer to ship to distributor", async function () {
      await expect(
        supplyChain.connect(manufacturer).createShipment(productId, distributor.address)
      ).to.emit(supplyChain, "ShipmentCreated");

      const shipment = await supplyChain.connect(manufacturer).getShipment(1);
      expect(shipment.from).to.equal(manufacturer.address);
      expect(shipment.to).to.equal(distributor.address);
      expect(shipment.status).to.equal(ShipmentStatus.CREATED);
    });

    it("Should allow manufacturer to ship directly to retailer", async function () {
      await expect(
        supplyChain.connect(manufacturer).createShipment(productId, retailer.address)
      ).to.emit(supplyChain, "ShipmentCreated");

      const shipment = await supplyChain.connect(manufacturer).getShipment(1);
      expect(shipment.to).to.equal(retailer.address);
    });

    it("Should allow distributor to ship to retailer", async function () {
      // First ship from manufacturer to distributor
      await supplyChain.connect(manufacturer).createShipment(productId, distributor.address);
      
      // Then distributor ships to retailer
      await expect(
        supplyChain.connect(distributor).createShipment(productId, retailer.address)
      ).to.emit(supplyChain, "ShipmentCreated");
    });

    it("Should prevent retailer from creating shipments", async function () {
      await expect(
        supplyChain.connect(retailer).createShipment(productId, distributor.address)
      ).to.be.revertedWith("Retailers cannot create shipments");
    });

    it("Should prevent shipping to unregistered participant", async function () {
      await expect(
        supplyChain.connect(manufacturer).createShipment(productId, unauthorized.address)
      ).to.be.revertedWith("Recipient not registered");
    });

    it("Should prevent shipping to self", async function () {
      await expect(
        supplyChain.connect(manufacturer).createShipment(productId, manufacturer.address)
      ).to.be.revertedWith("Cannot ship to yourself");
    });

    it("Should track product shipment history", async function () {
      await supplyChain.connect(manufacturer).createShipment(productId, distributor.address);
      await supplyChain.connect(manufacturer).createShipment(productId, retailer.address);
      
      const history = await supplyChain.connect(manufacturer).getProductHistory(productId);
      expect(history.length).to.equal(2);
      expect(history[0]).to.equal(1);
      expect(history[1]).to.equal(2);
    });
  });

  describe("Shipment Transfer and Receipt", function () {
    let productId, shipmentId;

    beforeEach(async function () {
      // Setup participants and product
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.registerParticipant(distributor.address, "XYZ Distributors", Role.DISTRIBUTOR);
      await supplyChain.registerParticipant(retailer.address, "RetailCo", Role.RETAILER);
      
      await supplyChain.connect(manufacturer).createProduct("Widget A");
      productId = 1;
      
      await supplyChain.connect(manufacturer).createShipment(productId, distributor.address);
      shipmentId = 1;
    });

    it("Should allow sender to transfer shipment", async function () {
      await expect(
        supplyChain.connect(manufacturer).transferShipment(shipmentId)
      ).to.emit(supplyChain, "ShipmentTransferred");

      const shipment = await supplyChain.connect(manufacturer).getShipment(shipmentId);
      expect(shipment.status).to.equal(ShipmentStatus.IN_TRANSIT);
    });

    it("Should allow recipient to receive shipment", async function () {
      await supplyChain.connect(manufacturer).transferShipment(shipmentId);
      
      await expect(
        supplyChain.connect(distributor).receiveShipment(shipmentId)
      ).to.emit(supplyChain, "ShipmentReceived");

      const shipment = await supplyChain.connect(distributor).getShipment(shipmentId);
      expect(shipment.status).to.equal(ShipmentStatus.RECEIVED);
    });

    it("Should prevent non-sender from transferring shipment", async function () {
      await expect(
        supplyChain.connect(distributor).transferShipment(shipmentId)
      ).to.be.revertedWith("Only sender can transfer shipment");
    });

    it("Should prevent non-recipient from receiving shipment", async function () {
      await supplyChain.connect(manufacturer).transferShipment(shipmentId);
      
      await expect(
        supplyChain.connect(manufacturer).receiveShipment(shipmentId)
      ).to.be.revertedWith("Only recipient can receive shipment");
    });

    it("Should prevent receiving shipment before transfer", async function () {
      await expect(
        supplyChain.connect(distributor).receiveShipment(shipmentId)
      ).to.be.revertedWith("Shipment not in transit");
    });

    it("Should prevent double transfer", async function () {
      await supplyChain.connect(manufacturer).transferShipment(shipmentId);
      
      await expect(
        supplyChain.connect(manufacturer).transferShipment(shipmentId)
      ).to.be.revertedWith("Shipment already transferred");
    });
  });

  describe("Complete Product Lifecycle", function () {
    it("Should simulate complete product lifecycle from manufacturer to retailer", async function () {
      // Register participants
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.registerParticipant(distributor.address, "XYZ Distributors", Role.DISTRIBUTOR);
      await supplyChain.registerParticipant(retailer.address, "RetailCo", Role.RETAILER);
      
      // Manufacturer creates product
      await supplyChain.connect(manufacturer).createProduct("Premium Widget");
      const productId = 1;
      
      // Manufacturer ships to distributor
      await supplyChain.connect(manufacturer).createShipment(productId, distributor.address);
      await supplyChain.connect(manufacturer).transferShipment(1);
      await supplyChain.connect(distributor).receiveShipment(1);
      
      // Distributor ships to retailer
      await supplyChain.connect(distributor).createShipment(productId, retailer.address);
      await supplyChain.connect(distributor).transferShipment(2);
      await supplyChain.connect(retailer).receiveShipment(2);
      
      // Verify complete history
      const history = await supplyChain.connect(manufacturer).getProductHistory(productId);
      expect(history.length).to.equal(2);
      
      const shipment1 = await supplyChain.connect(manufacturer).getShipment(1);
      const shipment2 = await supplyChain.connect(distributor).getShipment(2);
      
      expect(shipment1.status).to.equal(ShipmentStatus.RECEIVED);
      expect(shipment2.status).to.equal(ShipmentStatus.RECEIVED);
      
      console.log("✓ Complete lifecycle: Product created → Manufacturer → Distributor → Retailer");
    });
  });

  describe("Access Control", function () {
    beforeEach(async function () {
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.connect(manufacturer).createProduct("Widget A");
    });

    it("Should prevent unauthorized access to product information", async function () {
      await expect(
        supplyChain.connect(unauthorized).getProduct(1)
      ).to.be.revertedWith("Participant not registered");
    });

    it("Should allow registered participants to query products", async function () {
      const product = await supplyChain.connect(manufacturer).getProduct(1);
      expect(product.name).to.equal("Widget A");
    });

    it("Should verify authorization status", async function () {
      expect(await supplyChain.connect(manufacturer).isAuthorized()).to.be.true;
      expect(await supplyChain.connect(unauthorized).isAuthorized()).to.be.false;
    });
  });

  describe("Consensus and Data Integrity", function () {
    it("Should maintain immutable product creation timestamp", async function () {
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      
      const tx = await supplyChain.connect(manufacturer).createProduct("Widget A");
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      
      const product = await supplyChain.connect(manufacturer).getProduct(1);
      expect(product.createdAt).to.equal(block.timestamp);
    });

    it("Should maintain shipment event timestamps", async function () {
      await supplyChain.registerParticipant(manufacturer.address, "ABC Manufacturing", Role.MANUFACTURER);
      await supplyChain.registerParticipant(distributor.address, "XYZ Distributors", Role.DISTRIBUTOR);
      
      await supplyChain.connect(manufacturer).createProduct("Widget A");
      await supplyChain.connect(manufacturer).createShipment(1, distributor.address);
      
      const shipment = await supplyChain.connect(manufacturer).getShipment(1);
      expect(shipment.createdAt).to.be.gt(0);
    });
  });
});
