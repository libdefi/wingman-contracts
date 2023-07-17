// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC1155Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { ITokensRepository } from "./interfaces/ITokensRepository.sol";
import { IMarket } from "./interfaces/IMarket.sol";
import { IProduct } from "./interfaces/IProduct.sol";
import { IRegistry } from "./interfaces/IRegistry.sol";
import { RegistryMixinUpgradeable } from "./utils/RegistryMixin.sol";

contract DFIToken is
    ITokensRepository,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    RegistryMixinUpgradeable,
    UUPSUpgradeable
{
    mapping(uint256 => uint256) private _totalSupply;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IRegistry registry_) public initializer {
        __ERC1155_init("");
        __Ownable_init();
        __RegistryMixin_init(registry_);
        __UUPSUpgradeable_init();
    }

    function totalSupply(uint256 tokenId_) external view returns (uint256) {
        return _totalSupply[tokenId_];
    }

    function balanceOf(
        address account,
        uint256 id
    ) public view override(ERC1155Upgradeable, ITokensRepository) returns (uint256) {
        return ERC1155Upgradeable.balanceOf(account, id);
    }

    function mint(
        address to,
        uint256 tokenId,
        uint256 amount
    ) external onlyMarketTokens(_msgSender(), tokenId) {
        _mint(to, tokenId, amount, "");
    }

    function burn(
        address holder,
        uint256 tokenId,
        uint256 amount
    ) external onlyMarketTokens(_msgSender(), tokenId) {
        _burn(holder, tokenId, amount);
    }

    function _mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal virtual override {
        super._mint(to, id, amount, data);
        _totalSupply[id] += amount;
    }

    function _burn(address from, uint256 id, uint256 amount) internal virtual override {
        super._burn(from, id, amount);
        _totalSupply[id] -= amount;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
