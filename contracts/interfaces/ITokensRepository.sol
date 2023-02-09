// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

interface ITokensRepository {
    function totalSupply(uint256 tokenId) external view returns (uint256);

    function mint(address to, uint256 tokenId, uint256 amount) external;

    function burn(address holder, uint256 tokenId, uint256 amount) external;

    function balanceOf(address holder, uint256 tokenId) external view returns (uint256);
}
