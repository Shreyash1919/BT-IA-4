const hre = require("hardhat");

async function main() {
  console.log("Deploying SupplyChain contract...");

  // Get the contract factory
  const SupplyChain = await hre.ethers.getContractFactory("SupplyChain");
  
  // Deploy the contract
  const supplyChain = await SupplyChain.deploy();
  
  await supplyChain.waitForDeployment();
  
  const contractAddress = await supplyChain.getAddress();
  
  console.log(`SupplyChain contract deployed to: ${contractAddress}`);
  
  // Get deployer address
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployed by: ${deployer.address}`);
  console.log(`Admin address: ${deployer.address}`);
  
  return contractAddress;
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

module.exports = main;
