import ATokenYieldSourceAbi from '@pooltogether/aave-yield-source/abis/ATokenYieldSource.json';
import PoolWithMultipleWinnersBuilder from '@pooltogether/pooltogether-contracts/deployments/mainnet/PoolWithMultipleWinnersBuilder.json';
import ControlledTokenAbi from '@pooltogether/pooltogether-contracts/abis/ControlledToken.json';
import MultipleWinnersAbi from '@pooltogether/pooltogether-contracts/abis/MultipleWinners.json';
import YieldSourcePrizePoolAbi from '@pooltogether/pooltogether-contracts/abis/YieldSourcePrizePool.json';
import CTokenYieldSourceArtifact from '@pooltogether/pooltogether-contracts/artifacts/contracts/yield-source/CTokenYieldSource.sol/CTokenYieldSource.json';
import RNGBlockhash from '@pooltogether/pooltogether-rng-contracts/deployments/mainnet/RNGBlockhash.json';
import { dai } from '@studydefi/money-legos/erc20';
import { getChainByChainId } from 'evm-chains';
import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import {
  ADAI_ADDRESS_MAINNET,
  ATOKEN_YIELD_SOURCE_MAINNET,
  CDAI_ADDRESS_MAINNET,
  LENDING_POOL_ADDRESSES_PROVIDER_REGISTRY_ADDRESS_MAINNET,
} from '../Constant';
import { action, increaseTime as increaseTimeHelper, info, success } from '../helpers';
import { GenericProxyFactory, SwappableYieldSource as SwappableYieldSourceType } from '../types';

export default task('fork:create-swappable-prize-pool', 'Create a Swappable Prize Pool').setAction(
  async (taskArguments, hre: HardhatRuntimeEnvironment) => {
    const { artifacts, deployments, ethers, getChainId, getNamedAccounts } = hre;
    const { deploy } = deployments;

    const { constants, BigNumber, getContractAt, getContractFactory, provider, utils } = ethers;
    const { AddressZero } = constants;
    const { getBlock, getBlockNumber, getSigner, getTransactionReceipt } = provider;
    const { Interface, formatUnits, parseEther: toWei, parseUnits } = utils;

    const chainId = parseInt(await getChainId());
    const network = getChainByChainId(chainId).network;
    const increaseTime = (time: number) => increaseTimeHelper(hre, time);

    action(`Creating Yield Source Prize Pool on ${network}...`);

    const { deployer, genericProxyFactory } = await getNamedAccounts();
    const contractsOwner = getSigner(deployer);

    const allDeployments = await deployments.all();
    const { SwappableYieldSource: swappableYieldSourceProxyContract } = allDeployments;

    info(`Deployer: ${deployer}`);

    action('Deploying Aave DAI Yield Source...');

    const genericProxyFactoryContract = (await getContractAt(
      'GenericProxyFactory',
      genericProxyFactory,
    )) as GenericProxyFactory;

    const aTokenYieldSourceContract = await getContractAt(
      ATokenYieldSourceAbi,
      ATOKEN_YIELD_SOURCE_MAINNET,
      contractsOwner,
    );

    const aTokenYieldSourceInterface = new Interface(ATokenYieldSourceAbi);

    const aaveDAIYieldSourceConstructorArgs = aTokenYieldSourceInterface.encodeFunctionData(
      aTokenYieldSourceInterface.getFunction('initialize'),
      [
        ADAI_ADDRESS_MAINNET,
        LENDING_POOL_ADDRESSES_PROVIDER_REGISTRY_ADDRESS_MAINNET,
        18,
        'ptaDAI',
        'PoolTogether aDAI',
        contractsOwner._address,
      ],
    );

    const createAaveDAIYieldSourceResult = await genericProxyFactoryContract.create(
      aTokenYieldSourceContract.address,
      aaveDAIYieldSourceConstructorArgs,
    );

    const aaveDAIYieldSourceReceipt = await getTransactionReceipt(
      createAaveDAIYieldSourceResult.hash,
    );

    const createdAaveDAIYieldSourceEvent = genericProxyFactoryContract.interface.parseLog(
      aaveDAIYieldSourceReceipt.logs[0],
    );

    const aaveDAIYieldSourceAddress = createdAaveDAIYieldSourceEvent.args.created;

    success(`Deployed Aave DAI Yield Source! ${aaveDAIYieldSourceAddress}`);

    action('Deploying Swappable Yield Source initialized with Aave DAI Yield Source...');

    const swappableYieldSourceArtifact = await artifacts.readArtifact('SwappableYieldSource');
    const swappableYieldSourceABI = swappableYieldSourceArtifact.abi;
    const swappableYieldSourceInterface = new Interface(swappableYieldSourceABI);

    const swappableYieldSourceConstructorArgs = swappableYieldSourceInterface.encodeFunctionData(
      swappableYieldSourceInterface.getFunction('initialize'),
      [aaveDAIYieldSourceAddress, contractsOwner._address],
    );

    const createSwappableYieldSourceResult = await genericProxyFactoryContract.create(
      swappableYieldSourceProxyContract.address,
      swappableYieldSourceConstructorArgs,
    );

    const createSwappableYieldSourceReceipt = await getTransactionReceipt(
      createSwappableYieldSourceResult.hash,
    );

    const createSwappableYieldSourceEvent = genericProxyFactoryContract.interface.parseLog(
      createSwappableYieldSourceReceipt.logs[0],
    );

    const swappableYieldSourceAddress = createSwappableYieldSourceEvent.args.created;

    success(`Deployed Swappable Yield Source! ${swappableYieldSourceAddress}`);

    action('Deploying Swappable Yield Source Prize Pool...');

    const poolBuilder = await getContractAt(
      PoolWithMultipleWinnersBuilder.abi,
      PoolWithMultipleWinnersBuilder.address,
      contractsOwner,
    );

    const swappableYieldSourcePrizePoolConfig = {
      yieldSource: swappableYieldSourceAddress,
      maxExitFeeMantissa: toWei('0.5'),
      maxTimelockDuration: 1000,
    };

    const block = await getBlock(await getBlockNumber());

    const multipleWinnersConfig = {
      rngService: RNGBlockhash.address,
      prizePeriodStart: block.timestamp,
      prizePeriodSeconds: 60,
      ticketName: 'Ticket',
      ticketSymbol: 'TICK',
      sponsorshipName: 'Sponsorship',
      sponsorshipSymbol: 'SPON',
      ticketCreditLimitMantissa: toWei('0.1'),
      ticketCreditRateMantissa: toWei('0.001'),
      numberOfWinners: 1,
    };

    const yieldSourceMultipleWinnersTx = await poolBuilder.createYieldSourceMultipleWinners(
      swappableYieldSourcePrizePoolConfig,
      multipleWinnersConfig,
      18,
    );

    const yieldSourceMultipleWinnersReceipt = await getTransactionReceipt(
      yieldSourceMultipleWinnersTx.hash,
    );

    const yieldSourcePrizePoolInitializedEvents = yieldSourceMultipleWinnersReceipt.logs.map(
      (log: any) => {
        try {
          return poolBuilder.interface.parseLog(log);
        } catch (e) {
          return null;
        }
      },
    );

    const yieldSourcePrizePoolInitializedEvent = yieldSourcePrizePoolInitializedEvents.find(
      (event: any) => event && event.name === 'YieldSourcePrizePoolWithMultipleWinnersCreated',
    );

    const prizePool = await getContractAt(
      YieldSourcePrizePoolAbi,
      yieldSourcePrizePoolInitializedEvent?.args.prizePool,
      contractsOwner,
    );

    success(`Deployed Swappable Yield Source PrizePool! ${prizePool.address}`);

    const prizeStrategy = await getContractAt(
      MultipleWinnersAbi,
      await prizePool.prizeStrategy(),
      contractsOwner,
    );

    const ticketAddress = await prizeStrategy.ticket();
    const daiContract = await getContractAt(dai.abi, dai.address, contractsOwner);
    const daiDecimals = await daiContract.decimals()
    const depositAmount = parseUnits('100', daiDecimals);

    await daiContract.approve(prizePool.address, depositAmount);

    action(`Depositing ${formatUnits(depositAmount, daiDecimals)} ${dai.symbol} for ${contractsOwner._address}, ticket ${ticketAddress}...`);

    await prizePool.depositTo(
      contractsOwner._address,
      depositAmount,
      ticketAddress,
      AddressZero,
    );

    success('Deposit Successful!');

    info(`Prize strategy owner: ${await prizeStrategy.owner()}`);

    action('Starting award...');
    await increaseTime(60);
    await prizeStrategy.startAward();
    await increaseTime(1);

    action('Completing award...');
    const awardTx = await prizeStrategy.completeAward();
    const awardReceipt = await getTransactionReceipt(awardTx.hash);

    const awardLogs = awardReceipt.logs.map((log:any) => {
      try {
        return prizePool.interface.parseLog(log);
      } catch (e) {
        return null;
      }
    });

    awardReceipt.logs.map((log:any) => {
      try {
        return prizeStrategy.interface.parseLog(log);
      } catch (e) {
        return null;
      }
    });

    const awardedEvent = awardLogs.find((event:any) => event && event.name === 'Awarded');

    if (awardedEvent) {
      success(`Awarded ${formatUnits(awardedEvent?.args.amount, daiDecimals)} ${dai.symbol}!`);
    }

    action('Deploying Compound DAI Yield Source...');

    const cDaiYieldSourceResult = await deploy("cDaiYieldSource", {
      args: [
        CDAI_ADDRESS_MAINNET
      ],
      contract: CTokenYieldSourceArtifact,
      from: deployer,
      skipIfAlreadyDeployed: true
    })

    success(`Deployed Compound DAI Yield Source! ${cDaiYieldSourceResult.address}`);
    await increaseTime(60); // we increase time to make sure swap is successful
    action('Swapping Aave DAI Yield Source for Compound DAI Yield Source...');

    const ticket = await getContractAt(ControlledTokenAbi, ticketAddress, contractsOwner);

    const userBalanceBefore = await ticket.callStatic.balanceOf(contractsOwner._address);
    console.log('userBalanceBefore', formatUnits(userBalanceBefore));

    const swappableYieldSourceContract = await getContractAt(
      'SwappableYieldSource',
      swappableYieldSourceAddress,
      contractsOwner
    ) as unknown as SwappableYieldSourceType;

    info(`Yield Source address before swap ${await swappableYieldSourceContract.callStatic.yieldSource()}`);
    info(`PrizePool balanceOfToken before swap ${formatUnits((await swappableYieldSourceContract.callStatic.balanceOfToken(prizePool.address)))}`);
    info(`Swappable Yield Source balanceOfToken before swap ${formatUnits((await swappableYieldSourceContract.callStatic.balanceOfToken(swappableYieldSourceAddress)))}`);

    // await swappableYieldSourceContract.swapYieldSource(cDaiYieldSourceResult.address, prizePool.address);

    info(`Yield Source address after swap ${await swappableYieldSourceContract.callStatic.yieldSource()}`);
    info(`PrizePool balanceOfToken after swap ${formatUnits((await swappableYieldSourceContract.callStatic.balanceOfToken(prizePool.address)))}`);
    info(`Swappable Yield Source balanceOfToken after swap ${formatUnits((await swappableYieldSourceContract.callStatic.balanceOfToken(swappableYieldSourceAddress)))}`);

    success('Swapped Aave DAI Yield Source for Compound DAI Yield Source!');

    action('Withdrawing from PrizePool...');
    const withdrawalAmount = depositAmount.div(2);
    const earlyExitFee = await prizePool.callStatic.calculateEarlyExitFee(contractsOwner._address, ticketAddress, withdrawalAmount);

    // const userBalanceAfter = await ticket.callStatic.balanceOf(contractsOwner._address);
    // console.log('userBalanceAfter', formatUnits(userBalanceAfter));

    const withdrawTx = await prizePool.withdrawInstantlyFrom(
      contractsOwner._address,
      withdrawalAmount,
      ticketAddress,
      earlyExitFee.exitFee,
    );

    // await new Promise(r => setTimeout(r, 220000));
    const withdrawReceipt = await getTransactionReceipt(withdrawTx.hash);
    const withdrawLogs = withdrawReceipt.logs.map((log:any) => {
      try {
        return prizePool.interface.parseLog(log);
      } catch (e) {
        return null;
      }
    });

    const withdrawn = withdrawLogs.find((event:any) => event && event.name === 'InstantWithdrawal');
    success(`Withdrawn ${formatUnits(withdrawn?.args?.redeemed)} ${dai.symbol}!`);
    info(`Exit fee was ${withdrawn?.args?.exitFee} ${dai.symbol}`);

    await prizePool.captureAwardBalance();
    const awardBalance = await prizePool.callStatic.awardBalance();
    info(`Current awardable balance is ${awardBalance} ${dai.symbol}`);
  },
);
