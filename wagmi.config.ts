import { defineConfig } from '@wagmi/cli'
import { hardhat } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'artifacts/abi.ts',
  contracts: [
  ],
  plugins: [
    hardhat({
      project: '.',
      include: [
        '*/DFIRegistry.sol/**',
        '*/DFIFaucet.sol/**',
        '*/DFIToken.sol/**',
        '*/FlightDelayMarket.sol/**',
        '*/FlightInsurance.sol/**',
      ],
    }),
  ],
})
