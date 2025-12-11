// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint32, ebool, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title SimpleSealedAuction
 * @notice A simplified sealed-bid auction demonstrating FHE operations
 * @dev Educational example showing encrypted bid handling and FHE comparisons
 */
contract SimpleSealedAuction is ZamaEthereumConfig {
    // Auction metadata
    string public auctionTitle;
    address public seller;
    uint256 public auctionEndTime;
    uint256 public minimumBid;
    
    // Auction state
    bool public auctionEnded;
    
    // Bid storage
    struct Bid {
        euint32 encryptedAmount;
        uint256 escrowAmount;
        bool exists;
    }
    
    mapping(address => Bid) public bids;
    address[] public bidders;
    
    // Winner (determined after auction ends)
    address public winner;
    euint32 public encryptedWinningBid;  // Kept encrypted
    euint32 public encryptedWinnerIndex; // Index of winner in bidders array
    
    // Winner revelation (Phase 2)
    bool public winnerRevealed;
    uint256 public revealedWinnerIndex;
    uint256 public revealedWinningBid;
    
    // Refund tracking (Phase 3)
    mapping(address => bool) public refundClaimed;
    bool public sellerClaimed;
    
    // Events
    event BidPlaced(address indexed bidder, uint256 timestamp);
    event AuctionEnded(address indexed winner, uint256 timestamp);
    event WinnerRevealed(address indexed winner, uint256 winningBid);
    event RefundClaimed(address indexed bidder, uint256 amount);
    event SellerPaid(address indexed seller, uint256 amount);
    
    constructor(
        string memory _title,
        uint256 _durationInMinutes,
        uint256 _minimumBid
    ) {
        auctionTitle = _title;
        seller = msg.sender;
        minimumBid = _minimumBid;
        auctionEndTime = block.timestamp + (_durationInMinutes * 1 minutes);
    }
    
    /**
     * @notice Place an encrypted bid
     * @param inputEuint32 Encrypted bid amount
     * @param inputProof Zero-knowledge proof
     */
    function placeBid(
        externalEuint32 inputEuint32,
        bytes calldata inputProof
    ) external payable {
        require(block.timestamp < auctionEndTime, "Auction has ended");
        require(msg.value >= minimumBid, "Escrow must meet minimum bid");
        
        // Convert external encrypted input to internal encrypted value
        euint32 encryptedBid = FHE.fromExternal(inputEuint32, inputProof);
        
        // Grant permissions
        FHE.allowThis(encryptedBid);
        FHE.allow(encryptedBid, msg.sender);
        
        // Store bid
        if (bids[msg.sender].exists) {
            // Refund old escrow if updating bid
            uint256 oldEscrow = bids[msg.sender].escrowAmount;
            bids[msg.sender].encryptedAmount = encryptedBid;
            bids[msg.sender].escrowAmount = msg.value;
            
            payable(msg.sender).transfer(oldEscrow);
        } else {
            bids[msg.sender] = Bid({
                encryptedAmount: encryptedBid,
                escrowAmount: msg.value,
                exists: true
            });
            bidders.push(msg.sender);
        }
        
        emit BidPlaced(msg.sender, block.timestamp);
    }
    
    /**
     * @notice End auction and find winner using FHE operations
     * @dev Demonstrates encrypted comparison without decryption
     * 
     * We track both the maximum bid AND the index of the winning bidder.
     * Since we cannot branch on encrypted values, we use FHE.select to
     * conditionally update the winnerIndex whenever we update the maxBid.
     */
    function endAuction() external {
        require(block.timestamp >= auctionEndTime, "Auction still active");
        require(!auctionEnded, "Auction already ended");
        require(bidders.length > 0, "No bids placed");
        
        // Initialize maxBid and winnerIndex with the first bidder's data
        euint32 maxBid = bids[bidders[0]].encryptedAmount;
        euint32 winnerIndex = FHE.asEuint32(0);
        
        for (uint256 i = 1; i < bidders.length; i++) {
            euint32 currentBid = bids[bidders[i]].encryptedAmount;
            
            // Encrypted comparison: is currentBid > maxBid?
            ebool isGreater = FHE.gt(currentBid, maxBid);
            
            // Conditionally update max (stays encrypted!)
            maxBid = FHE.select(isGreater, currentBid, maxBid);
            
            // Conditionally update winner index (stays encrypted!)
            winnerIndex = FHE.select(isGreater, FHE.asEuint32(uint32(i)), winnerIndex);
        }
        
        encryptedWinningBid = maxBid;
        encryptedWinnerIndex = winnerIndex;
        
        // Grant contract permission to these new state variables
        FHE.allowThis(encryptedWinningBid);
        FHE.allowThis(encryptedWinnerIndex);
        
        auctionEnded = true;
        
        // We cannot emit the winner address because we haven't decrypted the index
        // In a real app, you would decrypt the index (if allowed) or use it in subsequent FHE ops
        emit AuctionEnded(address(0), block.timestamp);
    }
    
    /**
     * @notice Get encrypted winner index (for testing/verification)
     */
    function getEncryptedWinnerIndex() external view returns (euint32) {
        require(auctionEnded, "Auction not ended");
        return encryptedWinnerIndex;
    }

    /**
     * @notice Request access to view the auction results (winning bid and winner index)
     * @dev Grants FHE permissions to msg.sender to decrypt the results
     */
    function requestResultAccess() external {
        require(auctionEnded, "Auction not ended");
        FHE.allow(encryptedWinningBid, msg.sender);
        FHE.allow(encryptedWinnerIndex, msg.sender);
    }
    
    /**
     * @notice Get encrypted winning bid (for testing/verification)
     * @return The encrypted winning bid amount
     */
    function getEncryptedWinningBid() external view returns (euint32) {
        require(auctionEnded, "Auction not ended");
        return encryptedWinningBid;
    }
    
    /**
     * @notice Get bidder's encrypted bid
     * @return The encrypted bid amount
     */
    function getMyBid() external view returns (euint32) {
        require(bids[msg.sender].exists, "No bid placed");
        return bids[msg.sender].encryptedAmount;
    }
    
    /**
     * @notice Get auction info
     */
    function getAuctionInfo() external view returns (
        string memory title,
        uint256 endTime,
        uint256 minBid,
        bool ended,
        uint256 bidderCount
    ) {
        return (
            auctionTitle,
            auctionEndTime,
            minimumBid,
            auctionEnded,
            bidders.length
        );
    }
    
    // ========================================
    // PHASE 2: Public Winner Decryption
    // ========================================
    
    /**
     * @notice Reveal the winner using decryption proof from FHEVM Gateway
     * @dev Called by anyone with the decryption proof after publicDecrypt
     * @param decryptedIndex Decrypted winner index from publicDecrypt
     * @param decryptedBid Decrypted winning bid amount from publicDecrypt
     * @param proof Decryption proof from FHEVM Gateway (for verification)
     */
    function revealWinner(
        uint256 decryptedIndex,
        uint256 decryptedBid,
        bytes calldata proof
    ) external {
        require(auctionEnded, "Auction not ended");
        require(!winnerRevealed, "Winner already revealed");
        require(decryptedIndex < bidders.length, "Invalid winner index");
        
        // In production, verify proof against encryptedWinnerIndex and encryptedWinningBid
        // For this implementation, we trust the caller (can be enhanced with oracle verification)
        // Zama's @zama-fhe/oracle-solidity can be used for on-chain proof verification
        
        revealedWinnerIndex = decryptedIndex;
        revealedWinningBid = decryptedBid;
        winner = bidders[decryptedIndex];
        winnerRevealed = true;
        
        emit WinnerRevealed(winner, decryptedBid);
    }
    
    /**
     * @notice Get revealed winner info
     * @return winnerAddress The winner's address
     * @return winningBidAmount The winning bid amount
     * @return isRevealed Whether the winner has been revealed
     */
    function getWinnerInfo() external view returns (
        address winnerAddress,
        uint256 winningBidAmount,
        bool isRevealed
    ) {
        return (winner, revealedWinningBid, winnerRevealed);
    }
    
    // ========================================
    // PHASE 3: Refunds & Settlement
    // ========================================
    
    /**
     * @notice Claim refund (for non-winners only)
     * @dev Can only be called after winner is revealed
     */
    function claimRefund() external {
        require(winnerRevealed, "Winner not revealed yet");
        require(bids[msg.sender].exists, "No bid placed");
        require(msg.sender != winner, "Winner cannot claim refund");
        require(!refundClaimed[msg.sender], "Refund already claimed");
        
        refundClaimed[msg.sender] = true;
        uint256 escrowAmount = bids[msg.sender].escrowAmount;
        
        payable(msg.sender).transfer(escrowAmount);
        
        emit RefundClaimed(msg.sender, escrowAmount);
    }
    
    /**
     * @notice Seller claims the winning bid amount
     * @dev Can only be called by seller after winner is revealed
     */
    function sellerClaimWinnings() external {
        require(msg.sender == seller, "Only seller can claim");
        require(winnerRevealed, "Winner not revealed yet");
        require(!sellerClaimed, "Already claimed");
        
        sellerClaimed = true;
        uint256 winnerEscrow = bids[winner].escrowAmount;
        
        payable(seller).transfer(winnerEscrow);
        
        emit SellerPaid(seller, winnerEscrow);
    }
    
    /**
     * @notice Check if a bidder can claim refund
     * @param bidder Address to check
     * @return canClaim Whether the bidder can claim refund
     * @return amount Amount that can be refunded
     */
    function canClaimRefund(address bidder) external view returns (bool canClaim, uint256 amount) {
        if (!winnerRevealed) return (false, 0);
        if (!bids[bidder].exists) return (false, 0);
        if (bidder == winner) return (false, 0);
        if (refundClaimed[bidder]) return (false, 0);
        
        return (true, bids[bidder].escrowAmount);
    }
}
