import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("=".repeat(50));
    console.log("SimpleSealedAuction Deployment");
    console.log("=".repeat(50));
    console.log(`Network: ${network.name} (Chain ID: ${chainId})`);

    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH");

    if (balance === 0n) {
        console.error("\n❌ No ETH in wallet! Get testnet ETH first.");
        console.log("   Sepolia: https://sepoliafaucet.com/");
        console.log("   Zama: https://faucet.zama.ai/");
        return;
    }

    const title = "FHE Sealed Auction Demo";
    const duration = 60; // 60 minutes
    const minBid = 100; // 100 units minimum

    console.log("\nDeployment parameters:");
    console.log("- Title:", title);
    console.log("- Duration:", duration, "minutes");
    console.log("- Minimum bid:", minBid, "units");

    console.log("\nDeploying SimpleSealedAuction...");
    const factory = await ethers.getContractFactory("SimpleSealedAuction");
    const auction = await factory.deploy(title, duration, minBid);

    console.log("Waiting for confirmation...");
    await auction.waitForDeployment();

    const address = await auction.getAddress();
    console.log(`\n✅ Contract deployed to: ${address}`);

    // Determine network config
    let networkId = chainId;
    let rpcUrl = "";

    if (chainId === 11155111) {
        // Sepolia
        rpcUrl = "https://sepolia.infura.io/v3/YOUR_INFURA_KEY";
    } else if (chainId === 8009) {
        // Zama Devnet
        rpcUrl = "https://devnet.zama.ai";
    } else {
        rpcUrl = "http://localhost:8545";
    }

    // Get ABI
    const artifactPath = path.join(__dirname, "../artifacts/contracts/SimpleSealedAuction.sol/SimpleSealedAuction.json");

    if (!fs.existsSync(artifactPath)) {
        console.log("⚠️ Artifact not found. Run 'npx hardhat compile' first.");
        return;
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    // Create config.js for frontend
    const configContent = `// Auto-generated deployment config - ${new Date().toISOString()}
export const CONTARCT_ADDRESS = "${address}";
export const NETWORK_ID = ${networkId};
export const RPC_URL = "${rpcUrl}";
export const AUCTION_ABI = ${JSON.stringify(artifact.abi, null, 2)};
`;

    // Write to frontend config locations
    const configPaths = [
        path.join(__dirname, "../frontend/src/config.js"),
        path.join(__dirname, "../frontend/config.js")
    ];

    for (const configPath of configPaths) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, configContent);
        console.log(`📁 Config written: ${configPath}`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("🎉 DEPLOYMENT COMPLETE!");
    console.log("=".repeat(50));
    console.log(`\nContract Address: ${address}`);
    console.log(`Network: ${network.name} (${chainId})`);
    console.log("\nNext steps:");
    console.log("1. cd frontend && npm install && npm run build");
    console.log("2. Deploy to Vercel: npx vercel");
}

main().catch((error) => {
    console.error("Deployment failed:", error);
    process.exitCode = 1;
});
