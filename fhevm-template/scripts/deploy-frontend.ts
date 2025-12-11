import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    console.log("Deploying SimpleSealedAuction for Frontend...");

    const [seller] = await ethers.getSigners();
    const duration = 60; // 60 minutes
    const minBid = 100; // 100 units

    const factory = await ethers.getContractFactory("SimpleSealedAuction");
    const auction = await factory.deploy("Rare Digital Art #88", duration, minBid);
    await auction.waitForDeployment();

    const address = await auction.getAddress();
    console.log(`Contract deployed to: ${address}`);

    // Get ABI
    const artifactPath = path.join(__dirname, "../artifacts/contracts/SimpleSealedAuction.sol/SimpleSealedAuction.json");
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    // Create config.js for frontend
    const configContent = `
export const CONTARCT_ADDRESS = "${address}";
export const AUCTION_ABI = ${JSON.stringify(artifact.abi)};
export const NETWORK_ ID = 31337; // Hardhat Local
  `;

    fs.writeFileSync(path.join(__dirname, "../frontend/config.js"), configContent);
    console.log("Frontend config generated at frontend/config.js");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
