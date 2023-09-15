// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "../interfaces/ILPWallet.sol";
import "../interfaces/IMarket.sol";
import "../interfaces/IProduct.sol";

contract MockProduct is IProduct {
    mapping(bytes32 => address) private _markets;

    function getMarket(bytes32 marketId) external view override returns (address) {
        return _markets[marketId];
    }

    function setMarket(bytes32 marketId, address market) external {
        _markets[marketId] = market;
    }

    function provideLiquidity(ILPWallet wallet, IMarket market, uint256 amount) external {
        wallet.provideLiquidity(market, amount);
    }

    function onMarketLiquidity(
        bytes32 marketId,
        address provider,
        uint256 value
    ) external override {}

    function onMarketParticipateV2(
        bytes32 marketId,
        address account,
        uint256 value,
        bool betYes,
        uint256 amount,
        bool sponsored
    ) external override {}

    function onMarketWithdraw(
        bytes32 marketId,
        address account,
        uint256 amount,
        bool betYes,
        uint256 value
    ) external override {}

    function onMarketSettle(
        bytes32 marketId,
        bool yesWin,
        bytes calldata outcome
    ) external override {}

    function onMarketClaim(bytes32 marketId, address account, uint256 value) external override {}
}
