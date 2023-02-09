// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "../interfaces/IMarket.sol";
import "../interfaces/ITokensRepository.sol";

contract MockMarket is IERC165, IMarket {
    address _product;
    bytes32 _marketId;
    uint256 _tokenIdYes;
    uint256 _tokenIdNo;

    ITokensRepository _tokensRepo;

    constructor(
        address product_,
        bytes32 marketId_,
        uint256 tokenIdYes_,
        uint256 tokenIdNo_,
        ITokensRepository tokensRepo_
    ) {
        _product = product_;
        _marketId = marketId_;
        _tokenIdYes = tokenIdYes_;
        _tokenIdNo = tokenIdNo_;
        _tokensRepo = tokensRepo_;
    }

    function provideLiquidity() external payable override returns (bool success) {
        return true;
    }

    function product() external view override returns (address) {
        return _product;
    }

    function marketId() external view override returns (bytes32) {
        return _marketId;
    }

    function tokenIds() external view override returns (uint256 tokenIdYes, uint256 tokenIdNo) {
        return (_tokenIdYes, _tokenIdNo);
    }

    function tokenBalances() external view override returns (uint256 tokenBalanceYes, uint256 tokenBalanceNo) {
        return (_tokensRepo.totalSupply(_tokenIdYes), _tokensRepo.totalSupply(_tokenIdNo));
    }

    function mint(address to, uint256 id, uint256 amount) external {
        _tokensRepo.mint(to, id, amount);
    }

    function burn(address from, uint256 id, uint256 amount) external {
        _tokensRepo.burn(from, id, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IMarket).interfaceId;
    }

    function finalBalance() external view override returns (FinalBalance memory) {
        return FinalBalance(0, 0, 0);
    }

    function decisionState() external view override returns (DecisionState) {
        return DecisionState.NO_DECISION;
    }

    function config() external view override returns (Config memory) {
        return Config(0, 0, 0, 0, 0, 0, 0, Mode.BURN, address(0));
    }

    function tvl() external view override returns (uint256) {
        return 0;
    }

    function result() external view override returns (Result) {
        return Result.UNDEFINED;
    }

    function currentDistribution() external view override returns (uint256) {
        return 0;
    }

    function canBeSettled() external view override returns (bool) {
        return false;
    }

    function trySettle() external override {}

    function priceETHToYesNo(uint256 amountIn) external view override returns (uint256, uint256) {
        return (0, 0);
    }

    function priceETHForYesNoMarket(
        uint256 amountOut
    ) external view override returns (uint256, uint256) {
        return (0, 0);
    }

    function priceETHForYesNo(
        uint256 amountOut,
        address account
    ) external view override returns (uint256, uint256) {
        return (0, 0);
    }

    function participate(bool betYes) external payable override {}

    function withdrawBet(uint256 amount, bool betYes) external override {}

    function claim() external override {}
}
