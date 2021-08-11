import YieldSourceInterface from '@pooltogether/yield-source-interface/abis/IYieldSource.json';
import { Signer } from '@ethersproject/abstract-signer';
import { BigNumber } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { MockContract } from 'ethereum-waffle';
import { ethers, waffle } from 'hardhat';

import { ERC20Mintable, SwappableYieldSourceHarness } from '../types';

const { AddressZero, MaxUint256 } = ethers.constants;

describe('SwappableYieldSource', () => {
  let contractsOwner: Signer;
  let yieldSourceOwner: SignerWithAddress;
  let wallet2: SignerWithAddress;

  let yieldSource: MockContract;
  let replacementYieldSource: MockContract;
  let swappableYieldSource: SwappableYieldSourceHarness;

  let daiToken: ERC20Mintable;
  let aDAIToken: ERC20Mintable;

  let isInitializeTest = false;

  const initializeSwappableYieldSource = async (
    yieldSourceAddress: string,
    decimals: number,
    ownerAddress: string,
  ) => {
    await swappableYieldSource.initialize(
      yieldSourceAddress,
      decimals,
      'swsDAI',
      'PoolTogether Swappable Yield Source DAI',
      ownerAddress,
    );
  };

  const { getContractAt, getContractFactory, getSigners, utils } = ethers;
  const { deployMockContract } = waffle;
  const { parseEther: toWei, parseUnits } = utils;

  beforeEach(async () => {
    [contractsOwner, yieldSourceOwner, wallet2] = await getSigners();

    const ERC20MintableContract = await getContractFactory('ERC20Mintable', contractsOwner);

    daiToken = await ERC20MintableContract.deploy('Dai Stablecoin', 'DAI', 18);
    aDAIToken = await ERC20MintableContract.deploy('Aave interest bearing DAI ', 'aDAI', 18);

    yieldSource = await deployMockContract(contractsOwner, YieldSourceInterface);
    await yieldSource.mock.depositToken.returns(daiToken.address);

    replacementYieldSource = await deployMockContract(contractsOwner, YieldSourceInterface);
    await replacementYieldSource.mock.depositToken.returns(daiToken.address);

    const SwappableYieldSource = await getContractFactory('SwappableYieldSourceHarness');
    const hardhatSwappableYieldSourceHarness = await SwappableYieldSource.deploy();

    swappableYieldSource = (await getContractAt(
      'SwappableYieldSourceHarness',
      hardhatSwappableYieldSourceHarness.address,
      contractsOwner,
    )) as SwappableYieldSourceHarness;

    if (!isInitializeTest) {
      await initializeSwappableYieldSource(yieldSource.address, 18, yieldSourceOwner.address);
    }
  });

  describe('initialize()', () => {
    before(() => {
      isInitializeTest = true;
    });

    after(() => {
      isInitializeTest = false;
    });

    it('should fail if yieldSource is address zero', async () => {
      await expect(
        initializeSwappableYieldSource(AddressZero, 18, yieldSourceOwner.address),
      ).to.be.revertedWith('SwappableYieldSource/yieldSource-not-zero-address');
    });

    it('should fail if yieldSource address is not a yield source', async () => {
      const randomWallet = ethers.Wallet.createRandom();

      await expect(
        initializeSwappableYieldSource(randomWallet.address, 18, yieldSourceOwner.address),
      ).to.be.revertedWith('SwappableYieldSource/invalid-yield-source');
    });

    it('should fail if yieldSource depositToken is address zero', async () => {
      await yieldSource.mock.depositToken.returns(AddressZero);

      await expect(
        initializeSwappableYieldSource(yieldSource.address, 18, yieldSourceOwner.address),
      ).to.be.revertedWith('SwappableYieldSource/invalid-yield-source');
    });

    it('should fail if owner is address zero', async () => {
      await expect(
        initializeSwappableYieldSource(yieldSource.address, 18, AddressZero),
      ).to.be.revertedWith('Ownable: new owner is the zero address');
    });
  });

  describe('create()', () => {
    it('should create SwappableYieldSource', async () => {
      expect(await swappableYieldSource.yieldSource()).to.equal(yieldSource.address);
      expect(await swappableYieldSource.owner()).to.equal(yieldSourceOwner.address);
    });
  });

  describe('assetManager()', () => {
    it('should setAssetManager', async () => {
      await expect(swappableYieldSource.connect(yieldSourceOwner).setAssetManager(wallet2.address))
        .to.emit(swappableYieldSource, 'AssetManagerTransferred')
        .withArgs(AddressZero, wallet2.address);

      expect(await swappableYieldSource.assetManager()).to.equal(wallet2.address);
    });

    it('should fail to setAssetManager', async () => {
      await expect(
        swappableYieldSource.connect(yieldSourceOwner).setAssetManager(AddressZero),
      ).to.be.revertedWith('onlyOwnerOrAssetManager/assetManager-not-zero-address');
    });
  });

  describe('approveMaxAmount()', () => {
    it('should approve yieldSource to spend max uint256 amount', async () => {
      expect(
        await swappableYieldSource.connect(yieldSourceOwner).callStatic.approveMaxAmount(),
      ).to.equal(true);

      expect(await daiToken.allowance(swappableYieldSource.address, yieldSource.address)).to.equal(
        MaxUint256,
      );
    });

    it('should fail if not owner', async () => {
      await expect(
        swappableYieldSource.connect(wallet2).callStatic.approveMaxAmount(),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('depositToken()', () => {
    it('should return the underlying token', async () => {
      expect(await swappableYieldSource.depositToken()).to.equal(daiToken.address);
    });
  });

  describe('balanceOfToken()', () => {
    it('should return user balance', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('1000'));

      expect(await swappableYieldSource.callStatic.balanceOfToken(wallet2.address)).to.equal(
        toWei('500'),
      );
    });
  });

  describe('_tokenToShares()', () => {
    it('should return shares amount', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('1000'));

      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('10'))).to.equal(toWei('2'));
    });

    it('should return 0 if tokens param is 0', async () => {
      expect(await swappableYieldSource.callStatic.tokenToShares('0')).to.equal('0');
    });

    it('should return tokens if totalSupply is 0', async () => {
      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('100'))).to.equal(
        toWei('100'),
      );
    });

    it('should return shares even if yield source total supply has a lot of decimals', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('1'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('0.000000000000000005'));

      expect(
        await swappableYieldSource.callStatic.tokenToShares(toWei('0.000000000000000005')),
      ).to.equal(toWei('1'));
    });

    it('should return shares even if yield source total supply increases', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('100'));

      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('1'))).to.equal(toWei('2'));

      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(parseUnits('100', 36));

      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('1'))).to.equal(2);
    });

    it('should fail to return shares if yield source total supply increases too much', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('100'));

      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('1'))).to.equal(toWei('2'));

      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(parseUnits('100', 37));

      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('1'))).to.equal(0);
    });
  });

  describe('_sharesToToken()', () => {
    it('should return tokens amount', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('1000'));

      expect(await swappableYieldSource.callStatic.sharesToToken(toWei('2'))).to.equal(toWei('10'));
    });

    it('should return shares if totalSupply is 0', async () => {
      expect(await swappableYieldSource.callStatic.sharesToToken(toWei('100'))).to.equal(
        toWei('100'),
      );
    });

    it('should return tokens even if totalSupply has a lot of decimals', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('0.000000000000000005'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('100'));

      expect(
        await swappableYieldSource.callStatic.sharesToToken(toWei('0.000000000000000005')),
      ).to.equal(toWei('100'));
    });

    it('should return tokens even if yield source total supply increases', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(toWei('100'));

      expect(await swappableYieldSource.callStatic.sharesToToken(toWei('2'))).to.equal(toWei('1'));

      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(parseUnits('100', 36));

      expect(await swappableYieldSource.callStatic.sharesToToken(2)).to.equal(toWei('1'));
    });
  });

  const supplyTokenTo = async (userAmount: BigNumber, user: SignerWithAddress) => {
    const userAddress = user.address;

    await daiToken.mint(userAddress, toWei('200'));
    await daiToken.connect(user).approve(swappableYieldSource.address, MaxUint256);
    await daiToken.connect(user).approve(yieldSource.address, MaxUint256);

    await yieldSource.mock.balanceOfToken
      .withArgs(swappableYieldSource.address)
      .returns(toWei('300'));

    await yieldSource.mock.supplyTokenTo
      .withArgs(userAmount, swappableYieldSource.address)
      .returns();

    await swappableYieldSource.connect(user).supplyTokenTo(userAmount, userAddress);
  };

  describe('supplyTokenTo()', () => {
    let amount: BigNumber;

    beforeEach(async () => {
      amount = toWei('100');
    });

    it('should supply assets if totalSupply is 0', async () => {
      await supplyTokenTo(amount, yieldSourceOwner);
      expect(await swappableYieldSource.totalSupply()).to.equal(amount);
    });

    it('should supply assets if totalSupply is not 0', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('100'));
      await swappableYieldSource.mint(wallet2.address, toWei('100'));
      await supplyTokenTo(amount, yieldSourceOwner);
    });

    it('should revert on error', async () => {
      await expect(
        swappableYieldSource.supplyTokenTo(amount, swappableYieldSource.address),
      ).to.be.revertedWith('');
    });
  });

  describe('redeemToken()', () => {
    let yieldSourceOwnerBalance: BigNumber;
    let redeemAmount: BigNumber;

    beforeEach(() => {
      yieldSourceOwnerBalance = toWei('300');
      redeemAmount = toWei('100');
    });

    it('should redeem assets', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, yieldSourceOwnerBalance);
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceOwnerBalance);

      await yieldSource.mock.redeemToken.withArgs(redeemAmount).returns(redeemAmount);

      // After redeeming DAI tokens from `yieldSource`,
      // `swappableYieldSource` now owns `redeemAmount` of DAI tokens.
      await daiToken.mint(swappableYieldSource.address, redeemAmount);

      await swappableYieldSource.connect(yieldSourceOwner).redeemToken(redeemAmount);

      expect(await daiToken.balanceOf(yieldSourceOwner.address)).to.equal(redeemAmount);
      expect(await swappableYieldSource.totalSupply()).to.equal(
        yieldSourceOwnerBalance.sub(redeemAmount),
      );
    });

    it('should not be able to redeem assets if balance is 0', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('0'));

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).redeemToken(redeemAmount),
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });

    it('should fail to redeem if amount superior to balance', async () => {
      const yieldSourceOwnerLowBalance = toWei('10');
      const revertReason = 'ERC20: burn amount exceeds balance';

      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceOwnerLowBalance);

      await yieldSource.mock.redeemToken.withArgs(redeemAmount).revertsWithReason(revertReason);

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).redeemToken(redeemAmount),
      ).to.be.revertedWith(revertReason);
    });
  });

  describe('setYieldSource()', () => {
    it('should setYieldSource', async () => {
      expect(
        await swappableYieldSource
          .setYieldSource(yieldSource.address, replacementYieldSource.address),
      ).to.emit(swappableYieldSource, 'SwappableYieldSourceSet');

      expect(await swappableYieldSource.yieldSource()).to.equal(replacementYieldSource.address);
      expect(await daiToken.allowance(swappableYieldSource.address, yieldSource.address)).to.equal(
        0,
      );
    });

    it('should fail to setYieldSource if same yield source', async () => {
      await expect(
        swappableYieldSource.setYieldSource(yieldSource.address, yieldSource.address),
      ).to.be.revertedWith('SwappableYieldSource/same-yield-source');
    });

    it('should fail to setYieldSource if depositToken is different', async () => {
      await replacementYieldSource.mock.depositToken.returns(aDAIToken.address);

      await expect(
        swappableYieldSource
          .setYieldSource(yieldSource.address, replacementYieldSource.address),
      ).to.be.revertedWith('SwappableYieldSource/different-deposit-token');
    });
  });

  describe('transferFunds()', () => {
    let yieldSourceBalance: BigNumber;

    beforeEach(() => {
      yieldSourceBalance = toWei('600');
    });

    it('should transferFunds', async () => {
      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance);

      await yieldSource.mock.redeemToken.withArgs(yieldSourceBalance).returns(yieldSourceBalance);

      await daiToken.mint(swappableYieldSource.address, yieldSourceBalance);

      await replacementYieldSource.mock.supplyTokenTo
        .withArgs(yieldSourceBalance, swappableYieldSource.address)
        .returns();

      expect(
        await swappableYieldSource.transferFunds(
          yieldSource.address,
          replacementYieldSource.address,
        ),
      )
        .to.emit(swappableYieldSource, 'FundsTransferred')
        .withArgs(yieldSource.address, replacementYieldSource.address, yieldSourceBalance);
    });

    it('should fail to transferFunds if balanceDiff different from amount', async () => {
      const differentAmount = toWei('200');

      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance);

      await yieldSource.mock.redeemToken.withArgs(yieldSourceBalance).returns(yieldSourceBalance);

      await daiToken.mint(swappableYieldSource.address, differentAmount);

      await expect(
        swappableYieldSource.transferFunds(yieldSource.address, replacementYieldSource.address),
      ).to.be.revertedWith('SwappableYieldSource/transfer-amount-different');
    });
  });

  describe('swapYieldSource()', () => {
    let yieldSourceBalance: BigNumber;
    let replacementYieldSourceBalance: BigNumber;

    beforeEach(async () => {
      yieldSourceBalance = toWei('300');
      replacementYieldSourceBalance = toWei('600');

      await yieldSource.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance);

      await yieldSource.mock.redeemToken
        .withArgs(yieldSourceBalance)
        .returns(yieldSourceBalance);

      await daiToken.mint(swappableYieldSource.address, yieldSourceBalance);

      await replacementYieldSource.mock.supplyTokenTo
        .withArgs(yieldSourceBalance, swappableYieldSource.address)
        .returns();
    });

    it('should swapYieldSource if yieldSourceOwner', async () => {
      const transaction = await swappableYieldSource
        .connect(yieldSourceOwner)
        .swapYieldSource(replacementYieldSource.address);

      expect(transaction)
        .to.emit(swappableYieldSource, 'SwappableYieldSourceSet')
        .withArgs(replacementYieldSource.address);

      expect(transaction)
        .to.emit(swappableYieldSource, 'FundsTransferred')
        .withArgs(yieldSource.address, replacementYieldSource.address, yieldSourceBalance);

      expect(await swappableYieldSource.yieldSource()).to.equal(replacementYieldSource.address);
      expect(await daiToken.allowance(swappableYieldSource.address, yieldSource.address)).to.equal(
        0,
      );
    });

    it('should fail to swapYieldSource if yield source address is address zero', async () => {
      await expect(
        swappableYieldSource.connect(yieldSourceOwner).swapYieldSource(AddressZero),
      ).to.be.revertedWith('SwappableYieldSource/yield-source-not-zero-address');
    });

    it('should fail to swapYieldSource if not yieldSourceOwner', async () => {
      await expect(
        swappableYieldSource.connect(wallet2).swapYieldSource(yieldSource.address),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('transferERC20()', () => {
    const transferAmount = toWei('10');

    it('should transferERC20 if yieldSourceOwner', async () => {
      await daiToken.mint(swappableYieldSource.address, transferAmount);

      await expect(
        swappableYieldSource
          .connect(yieldSourceOwner)
          .transferERC20(daiToken.address, wallet2.address, transferAmount),
      ).to.emit(swappableYieldSource, 'TransferredERC20');
    });

    it('should transferERC20 if assetManager', async () => {
      await daiToken.mint(swappableYieldSource.address, transferAmount);

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).setAssetManager(wallet2.address),
      ).to.emit(swappableYieldSource, 'AssetManagerTransferred');

      await expect(
        swappableYieldSource
          .connect(wallet2)
          .transferERC20(daiToken.address, yieldSourceOwner.address, transferAmount),
      ).to.emit(swappableYieldSource, 'TransferredERC20');
    });

    it('should not allow to transfer yield source token', async () => {
      await expect(
        swappableYieldSource
          .connect(yieldSourceOwner)
          .transferERC20(yieldSource.address, wallet2.address, transferAmount),
      ).to.be.revertedWith('SwappableYieldSource/yield-source-token-transfer-not-allowed');
    });

    it('should fail to transferERC20 if not yieldSourceOwner or assetManager', async () => {
      await expect(
        swappableYieldSource
          .connect(wallet2)
          .transferERC20(daiToken.address, yieldSourceOwner.address, transferAmount),
      ).to.be.revertedWith('onlyOwnerOrAssetManager/owner-or-manager');
    });
  });
});
