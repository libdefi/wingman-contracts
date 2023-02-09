// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

interface IMarket {
    enum DecisionState {
        NO_DECISION,
        DECISION_NEEDED,
        DECISION_LOADING,
        DECISION_RENDERED
    }

    enum Result {
        UNDEFINED,
        YES,
        NO
    }

    enum Mode {
        BURN,
        BUYER
    }

    struct FinalBalance {
        uint256 bank;
        uint256 yes;
        uint256 no;
    }

    struct Config {
        uint64 cutoffTime;
        uint64 closingTime;
        uint256 lpBid;
        uint256 minBid;
        uint256 maxBid;
        uint16 initP;
        uint16 fee;
        Mode mode;
        address oracle;
    }

    function provideLiquidity() external payable returns (bool success);

    function product() external view returns (address);

    function marketId() external view returns (bytes32);

    function tokenIds() external view returns (uint256 tokenIdYes, uint256 tokenIdNo);

    function tokenBalances() external view returns (uint256 tokenBalanceYes, uint256 tokenBalanceNo);

    function finalBalance() external view returns (FinalBalance memory);

    function decisionState() external view returns (DecisionState);

    function config() external view returns (Config memory);

    function tvl() external view returns (uint256);

    function result() external view returns (Result);

    function currentDistribution() external view returns (uint256);

    function canBeSettled() external view returns (bool);

    function trySettle() external;

    function priceETHToYesNo(uint256 amountIn) external view returns (uint256, uint256);

    function priceETHForYesNoMarket(uint256 amountOut) external view returns (uint256, uint256);

    function priceETHForYesNo(
        uint256 amountOut,
        address account
    ) external view returns (uint256, uint256);

    function participate(bool betYes) external payable;

    function withdrawBet(uint256 amount, bool betYes) external;

    function claim() external;
}
