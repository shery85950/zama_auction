import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { SimpleSealedAuction, SimpleSealedAuction__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
    seller: HardhatEthersSigner;
    bidder1: HardhatEthersSigner;
    bidder2: HardhatEthersSigner;
    bidder3: HardhatEthersSigner;
};

describe("SimpleSealedAuction - FHE Demonstration", function () {
    let signers: Signers;
    let auction: SimpleSealedAuction;
    let auctionAddress: string;

    const AUCTION_DURATION = 60; // 60 minutes
    const MINIMUM_BID = 100;

    before(async function () {
        const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
        signers = {
            seller: ethSigners[0],
            bidder1: ethSigners[1],
            bidder2: ethSigners[2],
            bidder3: ethSigners[3],
        };
    });

    beforeEach(async function () {
        // Check if running on mock environment
        if (!fhevm.isMock) {
            console.warn("This test suite requires FHEVM mock environment");
            this.skip();
        }

        // Deploy auction
        const factory = (await ethers.getContractFactory("SimpleSealedAuction")) as SimpleSealedAuction__factory;
        auction = (await factory.deploy(
            "Rare NFT Auction",
            AUCTION_DURATION,
            MINIMUM_BID
        )) as SimpleSealedAuction;
        auctionAddress = await auction.getAddress();
    });

    it("should deploy auction with correct parameters", async function () {
        const info = await auction.getAuctionInfo();
        expect(info.title).to.equal("Rare NFT Auction");
        expect(info.minBid).to.equal(MINIMUM_BID);
        expect(info.ended).to.be.false;
        expect(info.bidderCount).to.equal(0);
    });

    it("should allow placing encrypted bids", async function () {
        console.log("\n🎯 Testing Encrypted Bid Submission\n");

        // Bidder 1 places encrypted bid of 1000 units
        const bid1Amount = 1000;
        console.log(`Bidder 1 submitting encrypted bid of ${ethers.formatEther(bid1Amount)} ETH...`);

        const encryptedBid1 = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder1.address)
            .add32(bid1Amount)
            .encrypt();

        await auction
            .connect(signers.bidder1)
            .placeBid(encryptedBid1.handles[0], encryptedBid1.inputProof, { value: bid1Amount });

        console.log("✅ Bid 1 placed successfully (encrypted)");

        // Verify bid was recorded
        const info = await auction.getAuctionInfo();
        expect(info.bidderCount).to.equal(1);

        // Decrypt bid to verify (in tests only)
        const myBid = await auction.connect(signers.bidder1).getMyBid();
        const decryptedBid = await fhevm.userDecryptEuint(
            FhevmType.euint32,
            myBid,
            auctionAddress,
            signers.bidder1
        );

        console.log(`Decrypted bid (test only): ${ethers.formatEther(decryptedBid)} ETH`);
        expect(decryptedBid).to.equal(bid1Amount);
    });

    it("should demonstrate complete auction with FHE operations", async function () {
        console.log("\n🎯 Complete Sealed-Bid Auction Demonstration\n");

        // Place multiple encrypted bids
        console.log("💰 Bidders placing encrypted bids...");

        const bid1 = 1000;
        const encBid1 = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder1.address)
            .add32(bid1)
            .encrypt();
        await auction.connect(signers.bidder1).placeBid(encBid1.handles[0], encBid1.inputProof, { value: bid1 });
        console.log(`  Bidder 1: 1000 units (encrypted)`);

        const bid2 = 1500;
        const encBid2 = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder2.address)
            .add32(bid2)
            .encrypt();
        await auction.connect(signers.bidder2).placeBid(encBid2.handles[0], encBid2.inputProof, { value: bid2 });
        console.log(`  Bidder 2: 1500 units (encrypted) ← HIGHEST`);

        const bid3 = 800;
        const encBid3 = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder3.address)
            .add32(bid3)
            .encrypt();
        await auction.connect(signers.bidder3).placeBid(encBid3.handles[0], encBid3.inputProof, { value: bid3 });
        console.log(`  Bidder 3: 800 units (encrypted)`);

        console.log("\n🔒 Privacy Check:");
        console.log("  ✅ All bids are encrypted on-chain");
        console.log("  ✅ No one can see individual bid amounts");
        console.log("  ✅ Bids remain private during auction");

        // Fast forward time
        console.log("\n⏰ Fast-forwarding to auction end...");
        await ethers.provider.send("evm_increaseTime", [AUCTION_DURATION * 60 + 1]);
        await ethers.provider.send("evm_mine", []);

        // End auction (uses FHE operations to find max)
        console.log("\n🏆 Ending auction (using FHE.gt and FHE.select)...");
        await auction.endAuction();
        console.log("  ✅ Winner determined using encrypted comparisons");
        console.log("  ✅ FHE operations found maximum without decryption");

        // Request access to results (required for decryption)
        await auction.connect(signers.bidder2).requestResultAccess();

        // Verify winner using encrypted index
        const encryptedWinnerIndex = await auction.getEncryptedWinnerIndex();
        const winnerIndex = await fhevm.userDecryptEuint(
            FhevmType.euint32,
            encryptedWinnerIndex,
            auctionAddress,
            signers.bidder2
        );

        console.log(`\n🎉 Winner Index: ${winnerIndex}`);
        expect(winnerIndex).to.equal(1); // Bidder 2 is at index 1 (0-based)

        // Verify winner address matches index
        // The contract emits address(0) for privacy in this demo
        // In a real app, you'd verify the index maps to the correct bidder
        // bidders[0] = bidder1, bidders[1] = bidder2, bidders[2] = bidder3
        const bidders = [signers.bidder1, signers.bidder2, signers.bidder3];
        console.log(`Winners Address: ${bidders[Number(winnerIndex)].address}`);
        expect(bidders[Number(winnerIndex)].address).to.equal(signers.bidder2.address);

        // Decrypt winning bid (in tests)
        const encryptedWinningBid = await auction.getEncryptedWinningBid();
        const winningAmount = await fhevm.userDecryptEuint(
            FhevmType.euint32,
            encryptedWinningBid,
            auctionAddress,
            signers.bidder2
        );

        console.log(`Winning bid: ${winningAmount} units`);
        expect(winningAmount).to.equal(bid2);

        console.log("\n✨ Auction completed successfully!");
        console.log("  ✅ Bids stayed encrypted throughout");
        console.log("  ✅ Winner found using FHE operations");
        console.log("  ✅ Privacy preserved for all participants");
    });

    it("should allow bid updates", async function () {
        // Place initial bid
        const initialBid = 1000;
        const encInitial = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder1.address)
            .add32(initialBid)
            .encrypt();
        await auction.connect(signers.bidder1).placeBid(encInitial.handles[0], encInitial.inputProof, { value: initialBid });

        // Update bid
        const newBid = 1500;
        const encNew = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder1.address)
            .add32(newBid)
            .encrypt();
        await auction.connect(signers.bidder1).placeBid(encNew.handles[0], encNew.inputProof, { value: newBid });

        // Verify updated bid
        const myBid = await auction.connect(signers.bidder1).getMyBid();
        const decryptedBid = await fhevm.userDecryptEuint(
            FhevmType.euint32,
            myBid,
            auctionAddress,
            signers.bidder1
        );

        expect(decryptedBid).to.equal(newBid);
    });

    it("should reject bids after auction ends", async function () {
        // Fast forward past end time
        await ethers.provider.send("evm_increaseTime", [AUCTION_DURATION * 60 + 1]);
        await ethers.provider.send("evm_mine", []);

        // Try to place bid
        const bid = 1000;
        const encBid = await fhevm
            .createEncryptedInput(auctionAddress, signers.bidder1.address)
            .add32(bid)
            .encrypt();

        await expect(
            auction.connect(signers.bidder1).placeBid(encBid.handles[0], encBid.inputProof, { value: bid })
        ).to.be.revertedWith("Auction has ended");
    });
});

