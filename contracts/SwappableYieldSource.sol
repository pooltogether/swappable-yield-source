// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@pooltogether/yield-source-interface/contracts/IYieldSource.sol";

/// @title Swappable yield source contract to allow a PoolTogether prize pool to swap between different yield sources
/// @dev This contract adheres to the PoolTogether yield source interface
/// @dev This contract inherits OwnableUpgradable
/// @notice Swappable yield source for a PoolTogether prize pool that generates yield by depositing into the specified yield source
contract SwappableYieldSource is IYieldSource, OwnableUpgradeable {
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /// @notice Emitted when the swappable yield source is initialized
  event SwappableYieldSourceInitialized(
    address indexed yieldSource,
    address indexed owner
  );

  /// @notice Emitted when yield source has been successfuly swapped
  event SwappedYieldSource(
    address indexed oldYieldSource,
    address indexed newYieldSource
  );

  /// @notice Yield source interface
  IYieldSource public yieldSource;

  /// @notice Mock Initializer to prevent initialization right after deploying
  function freeze() public initializer {
    //no-op
  }

  /// @notice Initializes the swappable yield source with the yieldSource address provided
  /// @param _yieldSource Address of yield source used to initialize this swappable yield source
  /// @param _owner Swappable yield source owner
  function initialize(
    IYieldSource _yieldSource,
    address _owner
  ) public initializer returns (bool) {
    yieldSource = _yieldSource;

    // A hack to determine whether it's an actual yield source
    (bool succeeded,) = address(_yieldSource).staticcall(abi.encode(_yieldSource.depositToken.selector));
    require(succeeded, "SwappableYieldSource/invalid-yield-source");

    __Ownable_init();
    transferOwnership(_owner);

    emit SwappableYieldSourceInitialized(address(_yieldSource), _owner);

    return true;
  }

  /// @notice Returns the ERC20 asset token used for deposits
  /// @return The ERC20 asset token address
  function depositToken() public view override returns (address) {
    return yieldSource.depositToken();
  }

  /// @notice Returns the total balance (in asset tokens). This includes the deposits and interest.
  /// @return The underlying balance of asset tokens
  function balanceOfToken(address addr) external override returns (uint256) {
    return yieldSource.balanceOfToken(addr);
  }

  /// @notice Supplies tokens to the current yield source. Allows assets to be supplied on other user's behalf using the `to` param.
  /// @param amount The amount of `depositToken()` to be supplied
  /// @param to The user whose balance will receive the tokens
  function supplyTokenTo(uint256 amount, address to) external override {
    IERC20Upgradeable _depositToken = IERC20Upgradeable(depositToken());

    _depositToken.safeTransferFrom(msg.sender, address(this), amount);
    _depositToken.safeApprove(address(yieldSource), amount);
    return yieldSource.supplyTokenTo(amount, to);
  }

  /// @notice Redeems tokens from the current yield source.
  /// @param amount The amount of `token()` to withdraw. Denominated in `token()` as above.
  /// @return The actual amount of tokens that were redeemed.
  function redeemToken(uint256 amount) external override returns (uint256) {
    IERC20Upgradeable _yieldSource = IERC20Upgradeable(address(yieldSource));
    IERC20Upgradeable _depositToken = IERC20Upgradeable(depositToken());

    /// @dev TODO: fix error `revert ERC20: transfer amount exceeds allowance`
    _yieldSource.safeApprove(address(yieldSource), amount);
    _yieldSource.safeTransferFrom(msg.sender, address(this), amount);

    /// @dev Swappable Yield Source need to have Yield Source tokens (eg: ptaDAI) to redeem
    (uint256 balanceDiff) = yieldSource.redeemToken(amount);
    _depositToken.safeTransfer(msg.sender, balanceDiff);

    return balanceDiff;
  }

  /// @notice Set new yield source
  /// @return true if operation is successful
  function _setYieldSource(address newYieldSource) internal returns (bool) {
    yieldSource = IYieldSource(newYieldSource);
    return true;
  }

  /// @notice Swap yieldSource for newYieldSource
  function swapYieldSource(address newYieldSource, address prizePool) external onlyOwner {
    uint256 balance = yieldSource.balanceOfToken(msg.sender);

    // IERC20Upgradeable(address(yieldSource)).safeTransferFrom(msg.sender, address(this), balance);
    // IERC20Upgradeable _depositToken = IERC20Upgradeable(depositToken());

    // IERC20Upgradeable(address(yieldSource)).safeTransferFrom(msg.sender, address(this), balance);
    // yieldSource.redeemToken(balance);
    // require(yieldSource.redeemToken(balance) == balance, "SwappableYieldSource/failed-to-redeem");

    IERC20Upgradeable(yieldSource.depositToken()).safeApprove(newYieldSource, balance);
    IYieldSource(newYieldSource).supplyTokenTo(balance, address(this));

    require(_setYieldSource(newYieldSource), "SwappableYieldSource/failed-to-set");
    emit SwappedYieldSource(address(yieldSource), newYieldSource);
  }
}
