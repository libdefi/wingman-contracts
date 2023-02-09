// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

interface IProduct {
    function getMarket(bytes32 marketId) external view returns (address);

    // hooks
    function onMarketLiquidity(bytes32 marketId, address provider, uint256 value) external;

    function onMarketParticipate(
        bytes32 marketId,
        address account,
        uint256 value,
        bool betYes,
        uint256 amount
    ) external;

    function onMarketWithdraw(
        bytes32 marketId,
        address account,
        uint256 amount,
        bool betYes,
        uint256 value
    ) external;

    function onMarketSettle(bytes32 marketId, bool yesWin, bytes calldata outcome) external;

    function onMarketClaim(bytes32 marketId, address account, uint256 value) external;
}
