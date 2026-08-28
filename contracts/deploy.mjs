// Deploy WrappedISK to Ethereum mainnet.
// Run: bun contracts/deploy.mjs            (dry run - estimates only)
//      bun contracts/deploy.mjs --broadcast (actually deploys)
//
// Requires env: ALCHEMY_API, BRIDGE_MNEMONIC
import { JsonRpcProvider, Wallet, ContractFactory, HDNodeWallet, Mnemonic, formatEther } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(fs.readFileSync(path.join(here, "build/WrappedISK.json"), "utf8"));

const broadcast = process.argv.includes("--broadcast");

const alchemy = process.env.ALCHEMY_API;
const mnemonic = process.env.BRIDGE_MNEMONIC;
if (!alchemy) throw new Error("ALCHEMY_API not set");
if (!mnemonic) throw new Error("BRIDGE_MNEMONIC not set");

const rpcUrl = alchemy.startsWith("http")
  ? alchemy
  : `https://eth-mainnet.g.alchemy.com/v2/${alchemy}`;

const provider = new JsonRpcProvider(rpcUrl);
// Operator key = HD index 0 on the standard EVM path, same as the bridge uses.
const operator = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), "m/44'/60'/0'/0/0").connect(
  provider,
);

const net = await provider.getNetwork();
const balance = await provider.getBalance(operator.address);
const fee = await provider.getFeeData();

console.log("network:    ", net.name, Number(net.chainId));
console.log("deployer:   ", operator.address);
console.log("balance:    ", formatEther(balance), "ETH");
console.log("maxFeePerGas:", fee.maxFeePerGas?.toString());

if (Number(net.chainId) !== 1) throw new Error(`Expected Ethereum mainnet (1), got ${net.chainId}`);

const factory = new ContractFactory(artifact.abi, artifact.bytecode, operator);
const deployTx = await factory.getDeployTransaction(operator.address);
const gas = await provider.estimateGas({ ...deployTx, from: operator.address });
const cost = gas * (fee.maxFeePerGas ?? 0n);

console.log("gas est:    ", gas.toString());
console.log("max cost:   ", formatEther(cost), "ETH");

if (!broadcast) {
  console.log("\nDry run only. Re-run with --broadcast to deploy.");
  process.exit(0);
}
if (balance < cost) throw new Error("Insufficient ETH for deployment");

const contract = await factory.deploy(operator.address);
console.log("\nbroadcast:  ", contract.deploymentTransaction()?.hash);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log("DEPLOYED:   ", address);
console.log("etherscan:   https://etherscan.io/address/" + address);

fs.writeFileSync(
  path.join(here, "build/deployment.json"),
  JSON.stringify(
    {
      chainId: Number(net.chainId),
      address,
      deployer: operator.address,
      txHash: contract.deploymentTransaction()?.hash,
      constructorArgs: [operator.address],
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
