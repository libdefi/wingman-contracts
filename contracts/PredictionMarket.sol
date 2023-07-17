// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { ERC2771Context } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { ITokensRepository } from "./interfaces/ITokensRepository.sol";
import { IMarket } from "./interfaces/IMarket.sol";
import { IProduct } from "./interfaces/IProduct.sol";

abstract contract PredictionMarket is IMarket, IERC165, ReentrancyGuard, ERC2771Context, Initializable {
    event DecisionRendered(Result result);
    event DecisionPostponed();
    event LiquidityProvided(address provider, uint256 amount);
    event ParticipatedInMarket(address indexed participant, uint256 amount, bool betYes);
    event BetWithdrawn(address indexed participant, uint256 amount, bool betYes);
    event RewardWithdrawn(address indexed participant, uint256 amount);

    bytes32 internal _marketId;
    uint256 internal _uniqueId;
    DecisionState internal _decisionState;
    Result internal _result;
    uint256 internal _ammConst;

    ITokensRepository internal _tokensRepo;
    FinalBalance internal _finalBalance;
    address payable internal _liquidityProvider;
    address payable internal _feeCollector;
    address private _createdBy;
    IProduct internal _product;

    Config internal _config;

    mapping(address => uint256) internal _bets;
    uint256 internal _tvl;

    uint256 private immutable _tokensBase = 10000;

    address private _trustedForwarder;

    constructor() ERC2771Context(address(0)) {}

    function __PredictionMarket_init(
        Config memory config_,
        uint256 uniqueId_,
        bytes32 marketId_,
        ITokensRepository tokensRepo_,
        address payable feeCollector_,
        IProduct product_,
        address trustedForwarder_
    ) internal onlyInitializing {
        _config = config_;
        _uniqueId = uniqueId_;
        _marketId = marketId_;
        _tokensRepo = tokensRepo_;
        _feeCollector = feeCollector_;
        _product = product_;
        _trustedForwarder = trustedForwarder_;

        _createdBy = msg.sender;
    }

    function product() external view returns (address) {
        return address(_product);
    }

    function marketId() external view returns (bytes32) {
        return _marketId;
    }

    function createdBy() external view returns (address) {
        return _createdBy;
    }

    function tokenSlots() external pure returns (uint8) {
        return 2;
    }

    function finalBalance() external view returns (FinalBalance memory) {
        return _finalBalance;
    }

    function decisionState() external view returns (DecisionState) {
        return _decisionState;
    }

    function config() external view returns (Config memory) {
        return _config;
    }

    function tvl() external view returns (uint256) {
        return _tvl;
    }

    function result() external view returns (Result) {
        return _result;
    }

    function tokenIds() external view returns (uint256 tokenIdYes, uint256 tokenIdNo) {
        tokenIdYes = _tokenIdYes();
        tokenIdNo = _tokenIdNo();
    }

    function tokenBalances() external view returns (uint256 tokenBalanceYes, uint256 tokenBalanceNo) {
        tokenBalanceYes = _tokensRepo.totalSupply(_tokenIdYes());
        tokenBalanceNo = _tokensRepo.totalSupply(_tokenIdNo());
    }

    /// @dev Returns the current distribution of tokens in the market. 2384 = 2.384%
    function currentDistribution() external view returns (uint256) {
        uint256 lpYes = _tokensRepo.balanceOf(_liquidityProvider, _tokenIdYes()); // 250
        uint256 lpNo = _tokensRepo.balanceOf(_liquidityProvider, _tokenIdNo()); // 10240

        uint256 lpTotal = lpYes + lpNo; // 10490
        return (lpNo * _tokensBase) / lpTotal; // 250 * 10000 / 10490 = 2384
    }

    function canBeSettled() external view returns (bool) {
        bool stateCheck = _decisionState == DecisionState.NO_DECISION ||
            _decisionState == DecisionState.DECISION_NEEDED;
        bool timeCheck = _config.closingTime < block.timestamp;
        return stateCheck && timeCheck;
    }

    function trySettle() external {
        require(block.timestamp > _config.cutoffTime, "Market is not closed yet");
        require(
            _decisionState == DecisionState.NO_DECISION ||
                _decisionState == DecisionState.DECISION_NEEDED,
            "Wrong market state"
        );

        _trySettle();

        _decisionState = DecisionState.DECISION_LOADING;

        _finalBalance = FinalBalance(
            _tvl,
            _tokensRepo.totalSupply(_tokenIdYes()),
            _tokensRepo.totalSupply(_tokenIdNo())
        );
    }

    function recordDecision(bytes calldata payload) external {
        require(msg.sender == address(_config.oracle), "Unauthorized sender");
        require(_decisionState == DecisionState.DECISION_LOADING, "Wrong state");

        (_decisionState, _result) = _renderDecision(payload);

        if (_decisionState == DecisionState.DECISION_RENDERED) {
            _claim(_liquidityProvider, true);
            emit DecisionRendered(_result);
            _product.onMarketSettle(_marketId, _result == Result.YES, payload);
        } else if (_decisionState == DecisionState.DECISION_NEEDED) {
            emit DecisionPostponed();
        }
    }

    function priceETHToYesNo(uint256 amountIn) external view returns (uint256, uint256) {
        // adjusts the fee
        amountIn -= _calculateFees(amountIn);

        return _priceETHToYesNo(amountIn);
    }

    function priceETHForYesNoMarket(uint256 amountOut) external view returns (uint256, uint256) {
        return _priceETHForYesNo(amountOut);
    }

    function priceETHForYesNo(
        uint256 amountOut,
        address account
    ) external view returns (uint256, uint256) {
        return _priceETHForYesNoWithdrawal(amountOut, account);
    }

    function priceETHForPayout(
        uint256 amountOut,
        address account,
        bool isYes
    ) external view returns (uint256) {
        return _priceETHForPayout(amountOut, account, isYes);
    }

    function provideLiquidity() external payable override returns (bool) {
        require(_liquidityProvider == address(0), "Already provided");
        require(msg.value == _config.lpBid, "Not enough to init");

        // it should be opposite for token types - initP indicates YES probability, but we mint NO tokens
        uint256 amountLPNo = (_tokensBase * (10 ** 18) * uint256(_config.initP)) / 10000;
        uint256 amountLPYes = (_tokensBase * (10 ** 18) * (10000 - uint256(_config.initP))) / 10000;

        // slither-disable-next-line divide-before-multiply
        _ammConst = amountLPYes * amountLPNo;
        _liquidityProvider = payable(msg.sender);
        _tvl += msg.value;

        _tokensRepo.mint(_liquidityProvider, _tokenIdYes(), amountLPYes);
        _tokensRepo.mint(_liquidityProvider, _tokenIdNo(), amountLPNo);

        emit LiquidityProvided(_liquidityProvider, msg.value);

        _product.onMarketLiquidity(_marketId, msg.sender, msg.value);

        return true;
    }

    function participate(bool betYes) external payable nonReentrant {
        // TODO: add slippage guard
        _beforeAddBet(_msgSender(), msg.value);
        _addBet(_msgSender(), betYes, msg.value);
    }

    function registerParticipant(address account, bool betYes) external payable nonReentrant {
        require(msg.sender == address(_product), "Unknown caller");

        _beforeAddBet(account, msg.value);
        _addBet(account, betYes, msg.value);
    }

    function withdrawBet(uint256 amount, bool betYes) external nonReentrant {
        require(_decisionState == DecisionState.NO_DECISION, "Wrong state");
        require(_config.cutoffTime > block.timestamp, "Market is closed");

        _withdrawBet(_msgSender(), betYes, amount);
    }

    function claim() external nonReentrant {
        require(_decisionState == DecisionState.DECISION_RENDERED);
        require(_result != Result.UNDEFINED);

        _claim(_msgSender(), false);
    }

    function _priceETHToYesNo(
        uint256 amountIn
    ) internal view returns (uint256 amountOutYes, uint256 amountOutNo) {
        uint256 amountBank = _tvl;
        uint256 totalYes = _tokensRepo.totalSupply(_tokenIdYes());
        uint256 totalNo = _tokensRepo.totalSupply(_tokenIdNo());

        amountOutYes = (amountIn * totalYes) / amountBank;
        amountOutNo = (amountIn * totalNo) / amountBank;
    }

    function _priceETHForYesNo(
        uint256 amountOut
    ) internal view returns (uint256 amountInYes, uint256 amountInNo) {
        uint256 amountBank = _tvl;
        uint256 totalYes = _tokensRepo.totalSupply(_tokenIdYes());
        uint256 totalNo = _tokensRepo.totalSupply(_tokenIdNo());

        amountInYes = (amountOut * amountBank) / totalYes;
        amountInNo = (amountOut * amountBank) / totalNo;
    }

    /**
     * Calculates the amount of ETH that needs to be sent to the contract to withdraw a given amount of YES/NO tokens
     * Compares existing market price with the price of the account's position (existing account's bank / account's YES/NO tokens)
     * The lesser of the two is used to calculate the amount of ETH that needs to be sent to the contract
     * @param amountOut - amount of YES/NO tokens to withdraw
     * @param account - account to withdraw from
     * @return amountInYes - amount of ETH to send to the contract for YES tokens
     * @return amountInNo - amount of ETH to send to the contract for NO tokens
     */
    function _priceETHForYesNoWithdrawal(
        uint256 amountOut,
        address account
    ) internal view returns (uint256 amountInYes, uint256 amountInNo) {
        uint256 amountBank = _tvl;
        uint256 totalYes = _tokensRepo.totalSupply(_tokenIdYes());
        uint256 totalNo = _tokensRepo.totalSupply(_tokenIdNo());

        uint256 marketAmountInYes = (amountOut * amountBank) / totalYes;
        uint256 marketAmountInNo = (amountOut * amountBank) / totalNo;

        uint256 accountBankAmount = _bets[account];
        uint256 accountTotalYes = _tokensRepo.balanceOf(account, _tokenIdYes());
        uint256 accountTotalNo = _tokensRepo.balanceOf(account, _tokenIdNo());

        uint256 accountAmountInYes = accountTotalYes == 0
            ? 0
            : (amountOut * accountBankAmount) / accountTotalYes;
        uint256 accountAmountInNo = accountTotalNo == 0
            ? 0
            : (amountOut * accountBankAmount) / accountTotalNo;

        amountInYes = marketAmountInYes > accountAmountInYes
            ? accountAmountInYes
            : marketAmountInYes;
        amountInNo = marketAmountInNo > accountAmountInNo ? accountAmountInNo : marketAmountInNo;
    }

    /**
     * Calculates the amount of ETH that could be paid out to the account if the market is resolved with a given result
     * and the account's position is YES/NO + amount of ETH sent to the contract
     * @param amountIn - amount of ETH potentially sent to the contract
     * @param account - account to calculate payout for or zero address if calculating for the new account (no wallet yet)
     * @param resultYes - potential result of the market
     */
    function _priceETHForPayout(
        uint256 amountIn,
        address account,
        bool resultYes
    ) internal view returns (uint256 payout) {
        // zero account addr check
        bool isAccountZero = account == address(0);
        // 1. Calculate the amount of ETH that the account has in the market + current total supply of YES/NO tokens
        uint256 accountTotalYes = isAccountZero ? 0 : _tokensRepo.balanceOf(account, _tokenIdYes());
        uint256 accountTotalNo = isAccountZero ? 0 : _tokensRepo.balanceOf(account, _tokenIdNo());

        uint256 amountLPYes = _tokensRepo.balanceOf(_liquidityProvider, _tokenIdYes());
        uint256 amountLPNo = _tokensRepo.balanceOf(_liquidityProvider, _tokenIdNo());

        uint256 finalYesSupply = _tokensRepo.totalSupply(_tokenIdYes());
        uint256 finalNoSupply = _tokensRepo.totalSupply(_tokenIdNo());

        // 2. Adjust with the amount of fees that the account could paid
        amountIn -= _calculateFees(amountIn);

        // 3. Calculate the amount of ETH that the market could have + YES/NO tokens that the account could get for amountIn
        uint256 finalBankAmount = _tvl + amountIn;

        uint256 userPurchaseYes;
        uint256 userPurchaseNo;
        (userPurchaseYes, userPurchaseNo) = _priceETHToYesNo(amountIn);

        if (resultYes) {
            // 5. Calculate the amount of ETH that the account could get for the final YES tokens
            accountTotalYes += userPurchaseYes;
            finalYesSupply += userPurchaseYes;
            amountLPNo += userPurchaseNo;
            finalNoSupply += userPurchaseNo;

            uint256 toBurn;
            uint256 toMint;
            (toBurn, toMint) = _calculateLPBalanceChange(resultYes, amountLPYes, amountLPNo);
            finalYesSupply = toBurn > 0 ? finalYesSupply - toBurn : finalYesSupply + toMint;
            // to stimulate YES bets, we need to add the burned tokens back to the account and final supply
            if (toBurn > 0) {
                accountTotalYes += toBurn;
                finalYesSupply += toBurn;
            }
            payout = (accountTotalYes * finalBankAmount) / finalYesSupply;
        } else {
            // 5. Calculate the amount of ETH that the account could get for the final NO tokens
            accountTotalNo += userPurchaseNo;
            finalNoSupply += userPurchaseNo;
            amountLPYes += userPurchaseYes;
            finalYesSupply += userPurchaseYes;

            uint256 toBurn;
            uint256 toMint;
            (toBurn, toMint) = _calculateLPBalanceChange(resultYes, amountLPYes, amountLPNo);
            finalNoSupply = toBurn > 0 ? finalNoSupply - toBurn : finalNoSupply + toMint;
            // for buyer mode, we need to add the burned tokens back to the account and final supply
            if (toBurn > 0 && _config.mode == Mode.BUYER) {
                accountTotalNo += toBurn;
                finalNoSupply += toBurn;
            }
            payout = (accountTotalNo * finalBankAmount) / finalNoSupply;
        }
    }

    // slither-disable-next-line reentrancy-no-eth reentrancy-eth
    function _addBet(address account, bool betYes, uint256 value) internal {
        uint256 fee = _calculateFees(value);
        value -= fee;

        uint256 userPurchaseYes;
        uint256 userPurchaseNo;
        (userPurchaseYes, userPurchaseNo) = _priceETHToYesNo(value);

        // 4. Mint for user and for DFI
        // 5. Also balance out DFI
        uint256 userPurchase;
        if (betYes) {
            userPurchase = userPurchaseYes;
            _tokensRepo.mint(account, _tokenIdYes(), userPurchaseYes);
            _tokensRepo.mint(_liquidityProvider, _tokenIdNo(), userPurchaseNo);
        } else {
            userPurchase = userPurchaseNo;
            _tokensRepo.mint(account, _tokenIdNo(), userPurchaseNo);
            _tokensRepo.mint(_liquidityProvider, _tokenIdYes(), userPurchaseYes);
        }

        _balanceLPTokens(account, betYes, false);

        _bets[account] += value;
        _tvl += value;

        (bool sent, ) = _feeCollector.call{value: fee}("");
        require(sent, "Cannot distribute the fee");

        // Check in AMM product is the same
        // FIXME: will never be the same because of rounding
        // amountLPYes = balanceOf(address(_lpWallet), tokenIdYes);
        // amountLPNo = balanceOf(address(_lpWallet), tokenIdNo);
        // require(ammConst == amountDfiYes * amountDfiNo, "AMM const is wrong");

        emit ParticipatedInMarket(account, value, betYes);
        _product.onMarketParticipate(_marketId, account, value, betYes, userPurchase);
    }

    // slither-disable-next-line reentrancy-eth reentrancy-no-eth
    function _withdrawBet(address account, bool betYes, uint256 amount) internal {
        uint256 userRefundYes;
        uint256 userRefundNo;
        (userRefundYes, userRefundNo) = _priceETHForYesNoWithdrawal(amount, account);

        uint256 userRefund;
        if (betYes) {
            userRefund = userRefundYes;

            _tokensRepo.burn(account, _tokenIdYes(), amount);
        } else {
            userRefund = userRefundNo;

            _tokensRepo.burn(account, _tokenIdNo(), amount);
        }

        // 6. Check in AMM product is the same
        // FIXME: will never be the same because of rounding
        // amountLpYes = balanceOf(address(_lpWallet), tokenIdYes);
        // amountLpNo = balanceOf(address(_lpWallet), tokenIdNo);
        // require(ammConst == amountLpYes * amountLpNo, "AMM const is wrong");

        if (userRefund > _bets[account]) {
            _bets[account] = 0;
        } else {
            _bets[account] -= userRefund;
        }
        _tvl -= userRefund;

        // TODO: add a fee or something
        (bool sent, ) = payable(account).call{value: userRefund}("");
        require(sent, "Cannot withdraw");

        emit BetWithdrawn(account, userRefund, betYes);
        _product.onMarketWithdraw(_marketId, account, amount, betYes, userRefund);
    }

    function _balanceLPTokens(address account, bool fixYes, bool isWithdraw) internal {
        uint256 tokenIdYes = _tokenIdYes();
        uint256 tokenIdNo = _tokenIdNo();

        uint256 amountLPYes = _tokensRepo.balanceOf(_liquidityProvider, tokenIdYes);
        uint256 amountLPNo = _tokensRepo.balanceOf(_liquidityProvider, tokenIdNo);

        // Pre-calculate the amount of tokens to burn/mint for the LP balance
        uint256 toBurn;
        uint256 toMint;
        (toBurn, toMint) = _calculateLPBalanceChange(fixYes, amountLPYes, amountLPNo);

        if (fixYes) {
            if (toBurn > 0) {
                // to stimulate YES bets, we need to add the burned tokens back to the account and final supply
                if (!isWithdraw) {
                    _tokensRepo.burn(_liquidityProvider, tokenIdYes, toBurn);
                    _tokensRepo.mint(account, tokenIdYes, toBurn);
                } else {
                    _tokensRepo.burn(_liquidityProvider, tokenIdYes, toBurn);
                }
            } else {
                _tokensRepo.mint(_liquidityProvider, tokenIdYes, toMint);
            }
        } else {
            if (toBurn > 0) {
                if (_config.mode == Mode.BUYER && !isWithdraw) {
                    _tokensRepo.burn(_liquidityProvider, tokenIdNo, toBurn);
                    _tokensRepo.mint(account, tokenIdNo, toBurn);
                } else {
                    _tokensRepo.burn(_liquidityProvider, tokenIdNo, toBurn);
                }
            } else {
                _tokensRepo.mint(_liquidityProvider, tokenIdNo, toMint);
            }
        }
    }

    // slither-disable-next-line reentrancy-eth reentrancy-no-eth
    function _claim(address account, bool silent) internal {
        bool yesWins = _result == Result.YES;

        uint256 reward;
        // TODO: if Yes wins and you had NoTokens - it will never be burned
        if (yesWins) {
            uint256 balance = _tokensRepo.balanceOf(account, _tokenIdYes());
            if (!silent) {
                require(balance > 0, "Nothing to withdraw");
            }

            reward = (balance * _finalBalance.bank) / _finalBalance.yes;

            _tokensRepo.burn(account, _tokenIdYes(), balance);
        } else {
            uint256 balance = _tokensRepo.balanceOf(account, _tokenIdNo());
            if (!silent) {
                require(balance > 0, "Nothing to withdraw");
            }

            reward = (balance * _finalBalance.bank) / _finalBalance.no;

            _tokensRepo.burn(account, _tokenIdNo(), balance);
        }

        if (reward > 0) {
            (bool sent, ) = payable(account).call{value: reward}("");
            require(sent, "Cannot withdraw");

            emit RewardWithdrawn(account, reward);
            _product.onMarketClaim(_marketId, account, reward);
        }
    }

    /**
     * Based on the existing balances of the LP tokens, calculate the amount of tokens to burn OR mint
     * In order to keep the AMM constant stable
     * @param fixYes - if true, fix the Yes token, otherwise fix the No token
     * @param amountLPYes - actual amount of Yes tokens in the LP wallet
     * @param amountLPNo - actual amount of No tokens in the LP wallet
     * @return amountToBurn - amount of tokens to burn to fix the AMM
     * @return amountToMint - amount of tokens to mint to fix the AMM
     */
    function _calculateLPBalanceChange(
        bool fixYes,
        uint256 amountLPYes,
        uint256 amountLPNo
    ) internal view returns (uint256 amountToBurn, uint256 amountToMint) {
        if (fixYes) {
            uint256 newAmountYes = _ammConst / (amountLPNo);
            amountToBurn = amountLPYes > newAmountYes ? amountLPYes - newAmountYes : 0;
            amountToMint = amountLPYes > newAmountYes ? 0 : newAmountYes - amountLPYes;
            return (amountToBurn, amountToMint);
        } else {
            uint256 newAmountNo = _ammConst / (amountLPYes);
            amountToBurn = amountLPNo > newAmountNo ? amountLPNo - newAmountNo : 0;
            amountToMint = amountLPNo > newAmountNo ? 0 : newAmountNo - amountLPNo;
            return (amountToBurn, amountToMint);
        }
    }

    /**
     * Calculate the value of the fees to hold from the given amountIn
     * @param amount - amountIn from which to calculate the fees
     */
    function _calculateFees(uint256 amount) internal view returns (uint256) {
        return (amount * uint256(_config.fee)) / 10000;
    }

    function _tokenIdYes() internal view returns (uint256) {
        return _uniqueId;
    }

    function _tokenIdNo() internal view returns (uint256) {
        return _uniqueId + 1;
    }

    function _beforeAddBet(address account, uint256 amount) internal view virtual {
        require(_config.cutoffTime > block.timestamp, "Market is closed");
        require(_decisionState == DecisionState.NO_DECISION, "Wrong state");
        require(amount >= _config.minBid, "Value included is less than min-bid");

        uint256 balance = _bets[account];
        uint256 fee = _calculateFees(amount);
        require(balance + amount - fee <= _config.maxBid, "Exceeded max bid");
    }

    function _trySettle() internal virtual;

    function _renderDecision(bytes calldata) internal virtual returns (DecisionState, Result);

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == 0xc79fd359 || interfaceId == type(IMarket).interfaceId;
    }

    function isTrustedForwarder(address forwarder) public view virtual override returns (bool) {
        return forwarder == _trustedForwarder;
    }
}
