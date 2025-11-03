// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title SupplyChain
 * @dev Tracks shipments across multiple participants in a supply chain
 * Implements role-based access control and product lifecycle management
 */
contract SupplyChain {
    
    // Enums for roles and shipment status
    enum Role { NONE, MANUFACTURER, DISTRIBUTOR, RETAILER }
    enum ShipmentStatus { CREATED, IN_TRANSIT, RECEIVED }
    
    // Structs
    struct Participant {
        address participantAddress;
        string name;
        Role role;
        bool isRegistered;
    }
    
    struct Product {
        uint256 productId;
        string name;
        address manufacturer;
        uint256 createdAt;
        bool exists;
    }
    
    struct Shipment {
        uint256 shipmentId;
        uint256 productId;
        address from;
        address to;
        ShipmentStatus status;
        uint256 createdAt;
        uint256 transferredAt;
        uint256 receivedAt;
    }
    
    // State variables
    address public admin;
    uint256 public productCounter;
    uint256 public shipmentCounter;
    
    // Mappings
    mapping(address => Participant) public participants;
    mapping(uint256 => Product) public products;
    mapping(uint256 => Shipment) public shipments;
    mapping(uint256 => uint256[]) public productShipmentHistory; // productId => shipmentIds[]
    
    // Events
    event ParticipantRegistered(address indexed participantAddress, string name, Role role);
    event ProductCreated(uint256 indexed productId, string name, address indexed manufacturer, uint256 timestamp);
    event ShipmentCreated(uint256 indexed shipmentId, uint256 indexed productId, address indexed from, address to, uint256 timestamp);
    event ShipmentTransferred(uint256 indexed shipmentId, address indexed from, address indexed to, uint256 timestamp);
    event ShipmentReceived(uint256 indexed shipmentId, address indexed receiver, uint256 timestamp);
    
    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }
    
    modifier onlyRegistered() {
        require(participants[msg.sender].isRegistered, "Participant not registered");
        _;
    }
    
    modifier onlyRole(Role _role) {
        require(participants[msg.sender].role == _role, "Unauthorized role");
        _;
    }
    
    modifier productExists(uint256 _productId) {
        require(products[_productId].exists, "Product does not exist");
        _;
    }
    
    modifier shipmentExists(uint256 _shipmentId) {
        require(_shipmentId > 0 && _shipmentId <= shipmentCounter, "Shipment does not exist");
        _;
    }
    
    // Constructor
    constructor() {
        admin = msg.sender;
        productCounter = 0;
        shipmentCounter = 0;
    }
    
    /**
     * @dev Register a new participant in the supply chain
     * @param _participantAddress Address of the participant
     * @param _name Name of the participant organization
     * @param _role Role of the participant (1: Manufacturer, 2: Distributor, 3: Retailer)
     */
    function registerParticipant(
        address _participantAddress,
        string memory _name,
        Role _role
    ) public onlyAdmin {
        require(_participantAddress != address(0), "Invalid address");
        require(_role != Role.NONE, "Invalid role");
        require(!participants[_participantAddress].isRegistered, "Participant already registered");
        
        participants[_participantAddress] = Participant({
            participantAddress: _participantAddress,
            name: _name,
            role: _role,
            isRegistered: true
        });
        
        emit ParticipantRegistered(_participantAddress, _name, _role);
    }
    
    /**
     * @dev Create a new product (only by manufacturers)
     * @param _name Name of the product
     */
    function createProduct(string memory _name) 
        public 
        onlyRegistered 
        onlyRole(Role.MANUFACTURER) 
        returns (uint256) 
    {
        require(bytes(_name).length > 0, "Product name cannot be empty");
        
        productCounter++;
        
        products[productCounter] = Product({
            productId: productCounter,
            name: _name,
            manufacturer: msg.sender,
            createdAt: block.timestamp,
            exists: true
        });
        
        emit ProductCreated(productCounter, _name, msg.sender, block.timestamp);
        
        return productCounter;
    }
    
    /**
     * @dev Create a new shipment
     * @param _productId ID of the product being shipped
     * @param _to Address of the recipient
     */
    function createShipment(uint256 _productId, address _to)
        public
        onlyRegistered
        productExists(_productId)
        returns (uint256)
    {
        require(_to != address(0), "Invalid recipient address");
        require(participants[_to].isRegistered, "Recipient not registered");
        require(msg.sender != _to, "Cannot ship to yourself");
        
        // Verify sender has authority over the product
        Participant memory sender = participants[msg.sender];
        Participant memory recipient = participants[_to];
        
        // Validate shipment flow: Manufacturer -> Distributor -> Retailer
        if (sender.role == Role.MANUFACTURER) {
            require(recipient.role == Role.DISTRIBUTOR || recipient.role == Role.RETAILER, 
                "Manufacturers can only ship to distributors or retailers");
        } else if (sender.role == Role.DISTRIBUTOR) {
            require(recipient.role == Role.RETAILER, 
                "Distributors can only ship to retailers");
        } else {
            revert("Retailers cannot create shipments");
        }
        
        shipmentCounter++;
        
        shipments[shipmentCounter] = Shipment({
            shipmentId: shipmentCounter,
            productId: _productId,
            from: msg.sender,
            to: _to,
            status: ShipmentStatus.CREATED,
            createdAt: block.timestamp,
            transferredAt: 0,
            receivedAt: 0
        });
        
        productShipmentHistory[_productId].push(shipmentCounter);
        
        emit ShipmentCreated(shipmentCounter, _productId, msg.sender, _to, block.timestamp);
        
        return shipmentCounter;
    }
    
    /**
     * @dev Transfer shipment (mark as in transit)
     * @param _shipmentId ID of the shipment
     */
    function transferShipment(uint256 _shipmentId)
        public
        onlyRegistered
        shipmentExists(_shipmentId)
    {
        Shipment storage shipment = shipments[_shipmentId];
        
        require(msg.sender == shipment.from, "Only sender can transfer shipment");
        require(shipment.status == ShipmentStatus.CREATED, "Shipment already transferred");
        
        shipment.status = ShipmentStatus.IN_TRANSIT;
        shipment.transferredAt = block.timestamp;
        
        emit ShipmentTransferred(_shipmentId, shipment.from, shipment.to, block.timestamp);
    }
    
    /**
     * @dev Receive shipment (mark as received)
     * @param _shipmentId ID of the shipment
     */
    function receiveShipment(uint256 _shipmentId)
        public
        onlyRegistered
        shipmentExists(_shipmentId)
    {
        Shipment storage shipment = shipments[_shipmentId];
        
        require(msg.sender == shipment.to, "Only recipient can receive shipment");
        require(shipment.status == ShipmentStatus.IN_TRANSIT, "Shipment not in transit");
        
        shipment.status = ShipmentStatus.RECEIVED;
        shipment.receivedAt = block.timestamp;
        
        emit ShipmentReceived(_shipmentId, msg.sender, block.timestamp);
    }
    
    /**
     * @dev Query product history (all shipments for a product)
     * @param _productId ID of the product
     */
    function getProductHistory(uint256 _productId)
        public
        view
        onlyRegistered
        productExists(_productId)
        returns (uint256[] memory)
    {
        return productShipmentHistory[_productId];
    }
    
    /**
     * @dev Get detailed product information
     * @param _productId ID of the product
     */
    function getProduct(uint256 _productId)
        public
        view
        onlyRegistered
        productExists(_productId)
        returns (
            uint256 productId,
            string memory name,
            address manufacturer,
            string memory manufacturerName,
            uint256 createdAt
        )
    {
        Product memory product = products[_productId];
        Participant memory mfg = participants[product.manufacturer];
        
        return (
            product.productId,
            product.name,
            product.manufacturer,
            mfg.name,
            product.createdAt
        );
    }
    
    /**
     * @dev Get detailed shipment information
     * @param _shipmentId ID of the shipment
     */
    function getShipment(uint256 _shipmentId)
        public
        view
        onlyRegistered
        shipmentExists(_shipmentId)
        returns (
            uint256 shipmentId,
            uint256 productId,
            address from,
            string memory fromName,
            address to,
            string memory toName,
            ShipmentStatus status,
            uint256 createdAt,
            uint256 transferredAt,
            uint256 receivedAt
        )
    {
        Shipment memory shipment = shipments[_shipmentId];
        Participant memory sender = participants[shipment.from];
        Participant memory recipient = participants[shipment.to];
        
        return (
            shipment.shipmentId,
            shipment.productId,
            shipment.from,
            sender.name,
            shipment.to,
            recipient.name,
            shipment.status,
            shipment.createdAt,
            shipment.transferredAt,
            shipment.receivedAt
        );
    }
    
    /**
     * @dev Get participant information
     * @param _participantAddress Address of the participant
     */
    function getParticipant(address _participantAddress)
        public
        view
        returns (
            address participantAddress,
            string memory name,
            Role role,
            bool isRegistered
        )
    {
        Participant memory participant = participants[_participantAddress];
        return (
            participant.participantAddress,
            participant.name,
            participant.role,
            participant.isRegistered
        );
    }
    
    /**
     * @dev Check if caller is authorized to access specific information
     */
    function isAuthorized() public view returns (bool) {
        return participants[msg.sender].isRegistered;
    }
    
    /**
     * @dev Get total number of products
     */
    function getTotalProducts() public view returns (uint256) {
        return productCounter;
    }
    
    /**
     * @dev Get total number of shipments
     */
    function getTotalShipments() public view returns (uint256) {
        return shipmentCounter;
    }
}
