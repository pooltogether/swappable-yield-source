// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.6;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@pooltogether/fixed-point/contracts/FixedPoint.sol";
import "@pooltogether/yield-source-interface/contracts/IYieldSource.sol";

import "./access/AssetManager.sol";

/// @title Swappable yield source contract to allow a PoolTogether prize pool to swap between different yield sources.
/// @dev This contract adheres to the PoolTogether yield source interface.
/// @dev This contract inherits AssetManager which extends OwnableUpgradable.
/// @notice Swappable yield source for a PoolTogether prize pool that generates yield by depositing into the specified yield source.
contract SwappableYieldSource is ERC20Upgradeable, IYieldSource, AssetManager, ReentrancyGuardUpgradeable {
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /// @notice Emitted when the swappable yield source is initialized.
  /// @param yieldSource Address of yield source used to initialize this swappable yield source.
  /// @param decimals Number of decimals the shares (inherited ERC20) will have.  Same as underlying asset to ensure same ExchangeRates.
  /// @param symbol Token symbol for the underlying ERC20 shares (eg: sysDAI).
  /// @param name Token name for the underlying ERC20 shares (eg: PoolTogether Swappable Yield Source DAI).
  /// @param owner Swappable yield source owner.
  event SwappableYieldSourceInitialized(
    IYieldSource indexed yieldSource,
    uint8 decimals,
    string symbol,
    string name,
    address indexed owner
  );

  /// @notice Emitted when a yield source has been successfuly set.
  /// @param yieldSource Yield source address that was set.
  event SwappableYieldSourceSet(
    IYieldSource indexed yieldSource
  );

  /// @notice Emitted when funds are successfully transferred from specified yield source to current yield source.
  /// @param oldYieldSource Previous address of yield source that provided funds.
  /// @param newYieldSource New address of yield source that received funds.
  /// @param amount Amount of funds transferred.
  event FundsTransferred(
    IYieldSource indexed oldYieldSource,
    IYieldSource indexed newYieldSource,
    uint256 amount
  );

  /// @notice Emitted when ERC20 tokens other than yield source's tokens are withdrawn from the swappable yield source.
  /// @param from Address that transferred funds.
  /// @param to Address that received funds.
  /// @param amount Amount of tokens transferred.
  /// @param token ERC20 token transferred.
  event TransferredERC20(
    address indexed from,
    address indexed to,
    uint256 amount,
    IERC20Upgradeable indexed token
  );

  /// @notice Yield source interface.
  IYieldSource public yieldSource;

  /// @notice Address of the ERC20 asset token deposited into the current yield source.
  address public override depositToken;

  /// @notice Mock Initializer to initialize implementations used by minimal proxies.
  function freeze() external initializer {
    //no-op
  }

  /// @notice Hack to determine if address passed is an actual yield source.
  /// @dev If _depositTokenData.length is not superior to 0, then staticcall didn't return any data.
  /// @param _yieldSource Yield source address to check.
  /// @return _depositToken Address of the ERC20 token deposited into the yield source.
  function _requireYieldSource(IYieldSource _yieldSource) internal view returns (address _depositToken) {
    require(address(_yieldSource) != address(0), "SwappableYieldSource/yieldSource-not-zero-address");

    (bool result, bytes memory _depositTokenData) = address(_yieldSource).staticcall(abi.encodePacked(_yieldSource.depositToken.selector));

    bool isValidYieldSource = result;

    if (result && _depositTokenData.length > 0) {
      (_depositToken) = abi.decode(_depositTokenData, (address));

      isValidYieldSource = _depositToken != address(0);
    }

    require(isValidYieldSource, "SwappableYieldSource/invalid-yield-source");
  }

  /// @notice Initializes the swappable yield source with the yieldSource address provided.
  /// @dev We approve yieldSource to spend maxUint256 amount of depositToken (eg: DAI), to save gas for future calls.
  /// @param _yieldSource Yield source address used to initialize this swappable yield source.
  /// @param _decimals Number of decimals the shares (inherited ERC20) will have.  Same as underlying asset to ensure same ExchangeRates.
  /// @param _symbol Token symbol for the underlying ERC20 shares (eg: sysDAI).
  /// @param _name Token name for the underlying ERC20 shares (eg: PoolTogether Swappable Yield Source DAI).
  /// @param _owner Swappable yield source owner.
  /// @return true if operation is successful.
  function initialize(
    IYieldSource _yieldSource,
    uint8 _decimals,
    string calldata _symbol,
    string calldata _name,
    address _owner
  ) external initializer returns (bool) {
    address _depositToken = _requireYieldSource(_yieldSource);

    depositToken = _depositToken;
    yieldSource = _yieldSource;

    __Ownable_init();
    transferOwnership(_owner);

    __ReentrancyGuard_init();

    __ERC20_init(_name, _symbol);
    _setupDecimals(_decimals);

    IERC20Upgradeable(_depositToken).safeApprove(address(_yieldSource), type(uint256).max);

    emit SwappableYieldSourceInitialized(
      _yieldSource,
      _decimals,
      _symbol,
      _name,
      _owner
    );

    return true;
  }

  /// @notice Approve yieldSource to spend maxUint256 amount of depositToken (eg: DAI).
  /// @dev Emergency function to re-approve max amount if approval amount dropped too low.
  /// @return true if operation is successful.
  function approveMaxAmount() external onlyOwner returns (bool) {
    address _yieldSource = address(yieldSource);
    IERC20Upgradeable _depositToken = IERC20Upgradeable(depositToken);

    uint256 _allowance = _depositToken.allowance(address(this), _yieldSource);
    _depositToken.safeIncreaseAllowance(_yieldSource, type(uint256).max.sub(_allowance));

    return true;
  }

  /// @notice Calculates the number of shares that should be minted or burned when a user deposit or withdraw.
  /// @param tokens Amount of tokens.
  /// @return Number of shares.
  function _tokenToShares(uint256 tokens) internal returns (uint256) {
    uint256 shares;
    uint256 _totalSupply = totalSupply();

    if (_totalSupply == 0) {
      shares = tokens;
    } else {
      // rate = tokens / shares
      // shares = tokens * (totalShares / yieldSourceTotalSupply)
      uint256 exchangeMantissa = FixedPoint.calculateMantissa(_totalSupply, yieldSource.balanceOfToken(address(this)));
      shares = FixedPoint.multiplyUintByMantissa(tokens, exchangeMantissa);
    }

    return shares;
  }

  /// @notice Calculates the number of tokens a user has in the yield source.
  /// @param shares Amount of shares.
  /// @return Number of tokens.
  function _sharesToToken(uint256 shares) internal returns (uint256) {
    uint256 tokens;
    uint256 _totalSupply = totalSupply();

    if (_totalSupply == 0) {
      tokens = shares;
    } else {
      // tokens = shares * (yieldSourceTotalSupply / totalShares)
      uint256 exchangeMantissa = FixedPoint.calculateMantissa(yieldSource.balanceOfToken(address(this)), _totalSupply);
      tokens = FixedPoint.multiplyUintByMantissa(shares, exchangeMantissa);
    }

    return tokens;
  }

  /// @notice Mint tokens to the user.
  /// @dev Shares corresponding to the number of tokens supplied are minted to user's balance.
  /// @param mintAmount Amount of asset tokens to be minted.
  /// @param to User whose balance will receive the tokens.
  function _mintShares(uint256 mintAmount, address to) internal {
    uint256 shares = _tokenToShares(mintAmount);

    require(shares > 0, "SwappableYieldSource/shares-gt-zero");

    _mint(to, shares);
  }

  /// @notice Burn shares from user's balance.
  /// @dev Shares corresponding to the number of tokens withdrawn are burnt from user's balance.
  /// @param burnAmount Amount of asset tokens to be burnt.
  function _burnShares(uint256 burnAmount) internal {
    uint256 shares = _tokenToShares(burnAmount);
    _burn(msg.sender, shares);
  }

  /// @notice Supplies tokens to the current yield source.  Allows assets to be supplied on other user's behalf using the `to` param.
  /// @dev Asset tokens are supplied to the yield source, then deposited into the underlying yield source (eg: Aave, Compound, etc...).
  /// @dev Shares from the yield source are minted to the swappable yield source address (this contract).
  /// @dev Shares from the swappable yield source are minted to the `to` address.
  /// @dev We substract `balanceBefore` from `balanceAfter` in case the token transferred is a token that applies a fee on transfer.
  /// @param _amount Amount of `depositToken()` to be supplied.
  /// @param _to User whose balance will receive the tokens.
  function supplyTokenTo(uint256 _amount, address _to) external override nonReentrant {
    IERC20Upgradeable _depositToken = IERC20Upgradeable(depositToken);

    uint256 _balanceBefore = _depositToken.balanceOf(address(this));

    _depositToken.safeTransferFrom(msg.sender, address(this), _amount);

    uint256 _balanceAfter = _depositToken.balanceOf(address(this));
    uint256 _amountReceived = _balanceAfter.sub(_balanceBefore);

    yieldSource.supplyTokenTo(_amountReceived, address(this));

    _mintShares(_amountReceived, _to);
  }

  /// @notice Returns the total balance in swappable tokens (eg: swsDAI).
  /// @param _addr User address.
  /// @return Underlying balance of swappable tokens.
  function balanceOfToken(address _addr) external override returns (uint256) {
    return _sharesToToken(balanceOf(_addr));
  }

  /// @notice Redeems tokens from the current yield source.
  /// @dev Shares of the swappable yield source address (this contract) are burnt from the yield source.
  /// @dev Shares of the `msg.sender` address are burnt from the swappable yield source.
  /// @dev We check that the actual amount received is equal to the amount redeemed.
  /// @param _amount Amount of `depositToken()` to withdraw.
  /// @return Actual amount of tokens that were redeemed.
  function redeemToken(uint256 _amount) external override nonReentrant returns (uint256) {
    _burnShares(_amount);

    IERC20Upgradeable _depositToken = IERC20Upgradeable(depositToken);

    uint256 _balanceBefore = _depositToken.balanceOf(address(this));

    uint256 _amountRedeemed = yieldSource.redeemToken(_amount);

    uint256 _balanceAfter = _depositToken.balanceOf(address(this));
    uint256 _amountReceived = _balanceAfter.sub(_balanceBefore);

    require(_amountRedeemed == _amountReceived, "SwappableYieldSource/different-redeem-amount");

    _depositToken.safeTransfer(msg.sender, _amountRedeemed);

    return _amountRedeemed;
  }

  /// @notice Set new yield source.
  /// @dev After setting the new yield source, we need to approve it to spend maxUint256 amount of depositToken (eg: DAI).
  /// @param _oldYieldSource Previous yield source address to replace with `_newYieldSource`.
  /// @param _newYieldSource New yield source address to set.
  function _setYieldSource(IYieldSource _oldYieldSource, IYieldSource _newYieldSource) internal {
    require(address(_newYieldSource) != address(_oldYieldSource), "SwappableYieldSource/same-yield-source");

    address _depositTokenAddress = _newYieldSource.depositToken();
    require(_depositTokenAddress == depositToken, "SwappableYieldSource/different-deposit-token");

    yieldSource = _newYieldSource;

    IERC20Upgradeable _depositToken = IERC20Upgradeable(_depositTokenAddress);
    _depositToken.safeApprove(address(_newYieldSource), type(uint256).max);

    uint256 _allowance = _depositToken.allowance(address(this), address(_oldYieldSource));
    _depositToken.safeDecreaseAllowance(address(_oldYieldSource), _allowance);

    emit SwappableYieldSourceSet(_newYieldSource);
  }

  /// @notice Transfer funds from old yield source to new yield source.
  /// @dev We check that the `currentBalance` transferred is at least equal or superior to the `amountRedeemed` requested.
  /// @dev `amountRedeemed` can be inferior to `redeemAmount` if funds were deposited into a yield source that applies a fee on withdrawals.
  /// @dev `currentBalance` can be superior to `amountRedeemed` if there are some funds that remained idle in the swappabble yield source.
  /// @param _oldYieldSource Previous yield source address to transfer funds from.
  /// @param _newYieldSource New yield source address to transfer funds to.
  function _transferFunds(IYieldSource _oldYieldSource, IYieldSource _newYieldSource) internal {
    uint256 _redeemAmount = _oldYieldSource.balanceOfToken(address(this));
    uint256 _amountRedeemed = _oldYieldSource.redeemToken(_redeemAmount);

    uint256 _currentBalance = IERC20Upgradeable(depositToken).balanceOf(address(this));

    require(_amountRedeemed <= _currentBalance, "SwappableYieldSource/transfer-amount-inferior");

    _newYieldSource.supplyTokenTo(_currentBalance, address(this));

    emit FundsTransferred(_oldYieldSource, _newYieldSource, _currentBalance);
  }

  /// @notice Swap current yield source for new yield source.
  /// @dev This function is only callable by the owner.
  /// @dev We set a new yield source and then transfer funds from the now previous yield source to the new current yield source.
  /// @param _newYieldSource New yield source address to set and transfer funds to.
  /// @return true if operation is successful.
  function swapYieldSource(IYieldSource _newYieldSource) external onlyOwner nonReentrant returns (bool) {
    require(address(_newYieldSource) != address(0), "SwappableYieldSource/yield-source-not-zero-address");

    IYieldSource _oldYieldSource = yieldSource;

    _setYieldSource(_oldYieldSource, _newYieldSource);
    _transferFunds(_oldYieldSource, _newYieldSource);

    return true;
  }

  /// @notice Transfer ERC20 tokens other than the yield source's tokens held by this contract to the recipient address.
  /// @dev This function is only callable by the owner or asset manager.
  /// @param erc20Token ERC20 token to transfer.
  /// @param to Recipient of the tokens.
  /// @param amount Amount of tokens to transfer.
  /// @return true if operation is successful.
  function transferERC20(IERC20Upgradeable erc20Token, address to, uint256 amount) external onlyOwnerOrAssetManager returns (bool) {
    require(address(erc20Token) != address(yieldSource), "SwappableYieldSource/yield-source-token-transfer-not-allowed");
    erc20Token.safeTransfer(to, amount);
    emit TransferredERC20(msg.sender, to, amount, erc20Token);
    return true;
  }
}
