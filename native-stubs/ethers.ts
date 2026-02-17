// Native stub for ethers (web-only package)
// This allows the package to be imported without errors on React Native
// ethers is only used for web MetaMask integration

export const parseUnits = (value: string, decimals: number) => {
  throw new Error('ethers not available on native platform');
};

export const formatUnits = (value: any, decimals: number) => {
  throw new Error('ethers not available on native platform');
};

export class BrowserProvider {
  constructor(provider: any) {
    throw new Error('ethers not available on native platform');
  }
}

export class Contract {
  constructor(address: string, abi: any, signer: any) {
    throw new Error('ethers not available on native platform');
  }
}

export default {
  parseUnits,
  formatUnits,
  BrowserProvider,
  Contract,
};

