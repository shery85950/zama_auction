import { ethers } from "ethers";
import { CONTARCT_ADDRESS, AUCTION_ABI, NETWORK_ID } from './config.js';
import { getFHEInstance, encryptBidAmount, isFHEReady, toHex } from './fheContext.js';

// DOM Elements
const connectBtn = document.getElementById('connect-wallet-btn');
const walletInfo = document.getElementById('wallet-info');
const walletAddressSpan = document.getElementById('wallet-address');
const networkStatus = document.getElementById('network-status');
const loadingOverlay = document.getElementById('loading-overlay');

// Auction UI Elements
const titleEl = document.getElementById('auction-title');
const minBidEl = document.getElementById('min-bid');
const timeRemainingEl = document.getElementById('time-remaining');
const bidderCountEl = document.getElementById('bidder-count');
const badgeEl = document.getElementById('auction-status-badge');

// Bid Form
const bidForm = document.getElementById('bid-form');
const bidInput = document.getElementById('bid-amount');
const placeBidBtn = document.getElementById('place-bid-btn');

// Status Section
const statusContent = document.getElementById('user-status-content');

// State
let provider;
let signer;
let contract;
let userAddress;
let fhevmInstance;

async function init() {
    console.log("Initializing App...");

    if (window.ethereum) {
        provider = new ethers.BrowserProvider(window.ethereum);

        // check if already connected
        const accounts = await provider.send("eth_accounts", []);
        if (accounts.length > 0) {
            connectWallet();
        }
    } else {
        alert("Please install MetaMask to use this app!");
    }

    connectBtn.addEventListener('click', connectWallet);
    bidForm.addEventListener('submit', handleBid);
}

async function connectWallet() {
    try {
        setLoading(true);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        // Check Network
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(NETWORK_ID)) {
            networkStatus.classList.remove('hidden');
            networkStatus.textContent = `Wrong Network: ${network.chainId} (Expected ${NETWORK_ID})`;
            alert(`Please switch to Zama Devnet (Chain ID: ${NETWORK_ID})`);
            // Try to switch
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x' + NETWORK_ID.toString(16) }],
                });
            } catch (e) {
                console.warn("Could not switch network automatically");
            }
        } else {
            networkStatus.classList.add('hidden');
        }

        // Update UI
        connectBtn.classList.add('hidden');
        walletInfo.classList.remove('hidden');
        walletAddressSpan.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;

        // Initialize Contract
        contract = new ethers.Contract(CONTARCT_ADDRESS, AUCTION_ABI, signer);

        // Initialize FHEVM
        await initFhevm();

        // Load Data
        await loadAuctionData();

        // Enable buttons
        placeBidBtn.disabled = false;
        startAutoRefresh();

    } catch (err) {
        console.error("Connection Error:", err);
        alert("Failed to connect wallet.");
    } finally {
        setLoading(false);
    }
}

async function initFhevm() {
    console.log("Initializing real FHEVM...");

    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    // Must be on Sepolia for real FHE
    if (chainId !== 11155111) {
        showDemoMode("Connect to Sepolia testnet (Chain ID: 11155111)");
        return;
    }

    try {
        // Initialize real FHE SDK (from Z-Payment pattern)
        fhevmInstance = await getFHEInstance();
        console.log("✅ Real FHEVM initialized on Sepolia");

        // Show success banner
        showFHEStatus("🔐 Real FHE Encryption Active", "#22c55e");
    } catch (err) {
        console.error("FHE initialization failed:", err);
        showDemoMode("FHE init failed: " + err.message);
    }
}

function showDemoMode(message) {
    console.warn("Running in DEMO MODE - " + message);

    // Create a mock instance for demo purposes (fallback)
    fhevmInstance = {
        createEncryptedInput: (contractAddr, userAddr) => ({
            add32: (value) => { },
            encrypt: () => ({
                handles: [new Uint8Array(32).fill(0)],
                inputProof: new Uint8Array(32).fill(0)
            })
        })
    };

    showFHEStatus(`⚠️ DEMO MODE - ${message}`, "#f59e0b");
}

function showFHEStatus(message, bgColor) {
    // Remove existing banner if any
    const existing = document.getElementById('fhe-status-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'fhe-status-banner';
    banner.innerHTML = `<div style="background: ${bgColor}; color: ${bgColor === '#22c55e' ? 'white' : 'black'}; padding: 10px; text-align: center; font-weight: bold;">
        ${message}
    </div>`;
    document.body.prepend(banner);
}

async function loadAuctionData() {
    try {
        const info = await contract.getAuctionInfo();
        // SimpleSealedAuction returns: (title, endTime, minBid, ended, bidderCount)
        // 5 values, not 7!

        titleEl.textContent = info[0]; // title
        const endTime = Number(info[1]); // endTime
        minBidEl.textContent = `${info[2]} Units`; // minBid
        bidderCountEl.textContent = info[4].toString(); // bidderCount

        const isEnded = info[3]; // ended
        const now = Math.floor(Date.now() / 1000);
        const timeExpired = now >= endTime;

        timeRemainingEl.setAttribute('data-endtime', endTime);
        updateTimer(endTime, isEnded);

        if (isEnded) {
            badgeEl.textContent = "Ended";
            badgeEl.className = "status-badge ended";
            placeBidBtn.disabled = true;
            placeBidBtn.textContent = "Auction Ended";
        } else if (timeExpired) {
            // Time expired but endAuction() not called yet
            badgeEl.textContent = "Ready to End";
            badgeEl.className = "status-badge ending";
            badgeEl.style.background = "#f59e0b";
            placeBidBtn.disabled = false;
            placeBidBtn.textContent = "🏁 End Auction";
            placeBidBtn.onclick = endAuction;
        }

        // Check user status - SimpleSealedAuction doesn't have getBidderStatus
        // Just show basic status
        try {
            const bid = await contract.bids(userAddress);
            if (bid && bid.exists) {
                statusContent.innerHTML = `<p class="status-message success">You have placed an encrypted bid!</p>`;
            } else {
                statusContent.innerHTML = `<p class="status-message">You have not bid yet.</p>`;
            }
        } catch (e) {
            statusContent.innerHTML = `<p class="status-message">Connect wallet to see status</p>`;
        }

        // Update winner UI (Phase 2 & 3)
        await updateWinnerUI();

    } catch (err) {
        console.error("Error loading data:", err);
    }
}

async function checkUserStatus() {
    try {
        // Checking if user has a bid
        // We can call getBidderStatus(address)
        const status = await contract.getBidderStatus(userAddress);
        // returns (hasBid, isWinner, hasClaimedRefund)

        if (status[0]) {
            statusContent.innerHTML = `<p class="status-message success">You have placed an encrypted bid!</p>`;
            if (status[1]) {
                statusContent.innerHTML += `<p class="status-message highlight">🎉 You are the winner!</p>`;
            }
        } else {
            statusContent.innerHTML = `<p class="status-message">You have not bid yet.</p>`;
        }
    } catch (err) {
        console.warn("Status check failed", err);
    }
}

async function handleBid(e) {
    e.preventDefault();
    const amount = Number(bidInput.value);

    if (!amount || amount <= 0) {
        alert("Please enter a valid amount");
        return;
    }

    if (!fhevmInstance) {
        alert("FHEVM not initialized");
        return;
    }

    try {
        setLoading(true);

        console.log(`Encrypting bid: ${amount}...`);

        // Real FHE Encryption (using Z-Payment pattern)
        let handle, proof;

        if (isFHEReady()) {
            // Use real FHE encryption
            const encrypted = await encryptBidAmount(CONTARCT_ADDRESS, userAddress, amount);
            handle = toHex(encrypted.handle);
            proof = toHex(encrypted.proof);
            console.log("✅ Real encryption complete");
        } else {
            // Fallback to mock (demo mode)
            console.warn("Using mock encryption (FHE not ready)");
            const input = fhevmInstance.createEncryptedInput(CONTARCT_ADDRESS, userAddress);
            input.add32(amount);
            const encryptedInput = input.encrypt();
            handle = toHex(encryptedInput.handles[0]);
            proof = toHex(encryptedInput.inputProof);
        }

        // Escrow value (must be >= min bid)
        // For simplicity assuming min bid is small, we send 'amount' as value too? 
        // No, in this auction, msg.value is the escrow. 
        // Wait, usually the escrow amount = bid amount for valid payment?
        // Yes, line 142: require(msg.value >= minimumBid, ...); 
        // Actually usually escrow == bid amount so solver can claim it?
        // But here we encrypt the bid amount. So we don't know the bid amount on chain!
        // So we must escrow public amount >= encrypted amount?
        // Or is msg.value just a fee?
        // In this contract: "uint256 previousEscrow = bids[msg.sender].escrowAmount;"
        // "winner can claim prize... Transfer winner's escrow to seller".
        // It seems `msg.value` IS the real payment. 
        // If `msg.value` is public, then the bid amount (upper bound) is leaked?
        // YES. In this implementation `msg.value` leaks the bid capacity. 
        // "bids[msg.sender] = Bid({ encryptedAmount: encryptedBid, escrowAmount: msg.value ... })"
        // So the user must send ETH.
        // If I bid 500 encrypted, I should probably send 500 ETH (wei/units) publicly.
        // The privacy is: exact amount is hidden, but capped by msg.value?
        // No, check logic. `TFHE.decrypt(maxBid)` -> `winningBidAmount`.
        // `claimPrize` -> transfers `bids[winner].escrowAmount` to seller.
        // So if I bid 10 (encrypted) but sent 100 (public), seller gets 100.
        // That's a flaw in this specific contract logic if I overpay escrow.
        // But for this UI, we will just send `amount` as `value` as well.

        const tx = await contract.placeBid(handle, proof, { value: amount });
        await tx.wait();

        alert("Bid placed successfully!");
        loadAuctionData();
        bidInput.value = "";

    } catch (err) {
        console.error("Bid Error:", err);
        alert("Transaction failed: " + (err.shortMessage || err.message));
    } finally {
        setLoading(false);
    }
}

function updateTimer(endTime, isEnded) {
    if (isEnded) {
        timeRemainingEl.textContent = "Ended";
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    let diff = endTime - now;

    if (diff <= 0) {
        timeRemainingEl.textContent = "Ending...";
        return;
    }

    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;

    timeRemainingEl.textContent = `${h}h ${m}m ${s}s`;
}

function startAutoRefresh() {
    setInterval(loadAuctionData, 5000);
    setInterval(() => {
        // Just refresh timer locally
        const timerText = timeRemainingEl.textContent;
        if (!timerText.includes("End")) {
            // simplified
            updateTimer(Number(timeRemainingEl.getAttribute('data-endtime') || 0), false);
        }
    }, 1000);
}

/**
 * End the auction and determine winner using FHE operations
 */
async function endAuction() {
    if (!contract) {
        alert("Please connect wallet first");
        return;
    }

    try {
        setLoading(true);
        console.log("🏁 Ending auction...");

        const tx = await contract.endAuction();
        await tx.wait();

        alert("✅ Auction ended! Winner determined (encrypted). Click 'Reveal Winner' to decrypt.");
        loadAuctionData();

    } catch (err) {
        console.error("End Auction Error:", err);
        alert("Failed to end auction: " + (err.shortMessage || err.message));
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        loadingOverlay.classList.remove('hidden');
    } else {
        loadingOverlay.classList.add('hidden');
    }
}

// ========================================
// PHASE 2: Public Winner Decryption
// ========================================

/**
 * Reveal the auction winner using public decryption
 * Uses the real FHE publicDecrypt to get decrypted values with proof
 */
async function revealWinner() {
    if (!contract) {
        alert("Please connect wallet first");
        return;
    }

    try {
        setLoading(true);

        // Check if auction ended
        const info = await contract.getAuctionInfo();
        if (!info[3]) { // ended
            alert("Auction has not ended yet");
            return;
        }

        // Check if already revealed
        const winnerInfo = await contract.getWinnerInfo();
        if (winnerInfo[2]) { // isRevealed
            alert("Winner already revealed!");
            return;
        }

        // Get encrypted values
        await contract.requestResultAccess();
        const encryptedIndexHandle = await contract.getEncryptedWinnerIndex();
        const encryptedBidHandle = await contract.getEncryptedWinningBid();

        console.log("🔓 Starting user decryption (requires signature)...");

        // Import userDecrypt from fheContext
        const { userDecrypt } = await import('./fheContext.js');

        // User decrypt the winner index (requires signing)
        alert("You'll be asked to sign a message to decrypt the winner. This proves you have permission.");

        const decryptedIndex = await userDecrypt(
            encryptedIndexHandle.toString(),
            CONTARCT_ADDRESS,
            signer
        );
        console.log("Decrypted winner index:", decryptedIndex);

        // User decrypt the winning bid
        const decryptedBid = await userDecrypt(
            encryptedBidHandle.toString(),
            CONTARCT_ADDRESS,
            signer
        );
        console.log("Decrypted winning bid:", decryptedBid);

        // Call contract to reveal winner (proof not needed for user decrypt flow)
        const tx = await contract.revealWinner(
            decryptedIndex,
            decryptedBid,
            "0x" // Empty proof for user-triggered reveal
        );
        await tx.wait();

        alert("🎉 Winner revealed successfully!");
        loadAuctionData();

    } catch (err) {
        console.error("Reveal Winner Error:", err);
        alert("Failed to reveal winner: " + (err.shortMessage || err.message));
    } finally {
        setLoading(false);
    }
}

// ========================================
// PHASE 3: Refunds & Settlement
// ========================================

/**
 * Claim refund (for non-winners after winner is revealed)
 */
async function claimRefund() {
    if (!contract || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        setLoading(true);

        // Check if can claim
        const [canClaim, amount] = await contract.canClaimRefund(userAddress);
        if (!canClaim) {
            alert("Cannot claim refund. Either winner not revealed, you are the winner, or already claimed.");
            return;
        }

        const tx = await contract.claimRefund();
        await tx.wait();

        alert(`✅ Refund of ${amount} claimed successfully!`);
        loadAuctionData();

    } catch (err) {
        console.error("Claim Refund Error:", err);
        alert("Failed to claim refund: " + (err.shortMessage || err.message));
    } finally {
        setLoading(false);
    }
}

/**
 * Seller claims the winning bid amount
 */
async function sellerClaimWinnings() {
    if (!contract || !userAddress) {
        alert("Please connect wallet first");
        return;
    }

    try {
        setLoading(true);

        // Check if user is seller
        const seller = await contract.seller();
        if (userAddress.toLowerCase() !== seller.toLowerCase()) {
            alert("Only the seller can claim winnings");
            return;
        }

        const tx = await contract.sellerClaimWinnings();
        await tx.wait();

        alert("✅ Winnings claimed successfully!");
        loadAuctionData();

    } catch (err) {
        console.error("Seller Claim Error:", err);
        alert("Failed to claim winnings: " + (err.shortMessage || err.message));
    } finally {
        setLoading(false);
    }
}

/**
 * Update UI with winner info and action buttons
 */
async function updateWinnerUI() {
    if (!contract) return;

    try {
        const winnerInfo = await contract.getWinnerInfo();
        const isRevealed = winnerInfo[2];

        // Get or create winner section
        let winnerSection = document.getElementById('winner-section');
        if (!winnerSection) {
            winnerSection = document.createElement('div');
            winnerSection.id = 'winner-section';
            winnerSection.style.cssText = 'margin-top: 20px; padding: 15px; border: 2px solid #22c55e; border-radius: 8px; background: #f0fdf4;';
            statusContent.parentElement.appendChild(winnerSection);
        }

        if (isRevealed) {
            const winner = winnerInfo[0];
            const winningBid = winnerInfo[1];
            const isUserWinner = userAddress && userAddress.toLowerCase() === winner.toLowerCase();

            winnerSection.innerHTML = `
                <h3 style="margin: 0 0 10px 0; color: #16a34a;">🏆 Winner Revealed!</h3>
                <p><strong>Winner:</strong> ${winner.substring(0, 6)}...${winner.substring(38)}</p>
                <p><strong>Winning Bid:</strong> ${winningBid} units</p>
                ${isUserWinner ?
                    '<p style="color: #16a34a; font-weight: bold;">🎉 Congratulations! You won!</p>' :
                    `<button id="claim-refund-btn" style="margin-top: 10px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">Claim Refund</button>`
                }
            `;

            // Add event listener to refund button
            const refundBtn = document.getElementById('claim-refund-btn');
            if (refundBtn) {
                refundBtn.addEventListener('click', claimRefund);
            }
        } else {
            // Show reveal button if auction ended but not revealed
            const info = await contract.getAuctionInfo();
            if (info[3]) { // ended
                winnerSection.style.display = 'block';
                winnerSection.innerHTML = `
                    <h3 style="margin: 0 0 10px 0; color: #f59e0b;">⏳ Auction Ended - Winner Not Revealed</h3>
                    <p>Click below to reveal the winner using public decryption:</p>
                    <button id="reveal-winner-btn" style="margin-top: 10px; padding: 10px 20px; background: #8b5cf6; color: white; border: none; border-radius: 5px; cursor: pointer;">🔓 Reveal Winner</button>
                `;

                document.getElementById('reveal-winner-btn')?.addEventListener('click', revealWinner);
            } else {
                // Auction still active - hide the section completely
                winnerSection.style.display = 'none';
                winnerSection.innerHTML = '';
            }
        }
    } catch (err) {
        console.warn("Could not update winner UI:", err);
    }
}

// Update loadAuctionData to also update winner UI
const originalLoadAuctionData = loadAuctionData;

// Start
init();
