import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export interface Signers {
    seller: HardhatEthersSigner;
    bidder1: HardhatEthersSigner;
    bidder2: HardhatEthersSigner;
    bidder3: HardhatEthersSigner;
    bidder4: HardhatEthersSigner;
}
