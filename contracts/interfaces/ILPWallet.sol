// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "./IMarket.sol";

interface ILPWallet {
    function provideLiquidity(IMarket market, uint256 amount) external;

    function withdraw(address to, uint256 amount) external;
}
