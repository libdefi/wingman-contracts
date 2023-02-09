// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/interfaces/IERC165.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../interfaces/IMarket.sol";
import "../interfaces/IProduct.sol";
import "../interfaces/IRegistry.sol";

abstract contract RegistryMixin {
    IRegistry internal _registry;

    function isValidMarket(address operator) internal view returns (bool) {
        // check if it's even a market
        bool isMarket = IERC165(operator).supportsInterface(type(IMarket).interfaceId);
        require(isMarket);

        // get the product market claims it belongs to
        IMarket market = IMarket(operator);
        address productAddr = market.product();
        // check if the product is registered
        require(_registry.getId(productAddr) != 0, "Unknown product");

        // check that product has the market with the same address
        IProduct product = IProduct(productAddr);
        require(product.getMarket(market.marketId()) == operator, "Unknown market");

        return true;
    }

    modifier onlyMarket(address operator) {
        require(isValidMarket(operator));
        _;
    }

    modifier onlyMarketTokens(address operator, uint256 tokenId) {
        require(isValidMarket(operator));

        IMarket market = IMarket(operator);

        // check that market is modifying the tokens it controls
        (uint256 tokenIdYes, uint256 tokenIdNo) = market.tokenIds();
        require(tokenId == tokenIdYes || tokenId == tokenIdNo, "Wrong tokens");

        _;
    }

    modifier onlyMarketTokensMultiple(address operator, uint256[] calldata tokenIds) {
        require(isValidMarket(operator));

        IMarket market = IMarket(operator);

        // check that market is modifying the tokens it controls
        (uint256 tokenIdYes, uint256 tokenIdNo) = market.tokenIds();
        for (uint32 i = 0; i < tokenIds.length; i++) {
            require(tokenIds[i] == tokenIdYes || tokenIds[i] == tokenIdNo, "Wrong tokens");
        }

        _;
    }

    modifier onlyProduct() {
        require(_registry.getId(msg.sender) != 0, "Unknown product");
        _;
    }

    function _setRegistry(IRegistry registry_) internal {
        _registry = registry_;
    }
}

abstract contract RegistryMixinUpgradeable is Initializable, RegistryMixin {
    function __RegistryMixin_init(IRegistry registry_) internal onlyInitializing {
        _setRegistry(registry_);
    }
}
