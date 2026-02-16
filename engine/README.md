This project demonstrates a minimal implementation using `@deriverse/kit` on Solana Devnet.

## Prerequisites

- Node.js
- NPM

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```
    *Note: The `@deriverse/kit` package (v1.0.39) is newer than the current Devnet deployment. A patch might be required in `node_modules/@deriverse/kit/dist/structure_models.js` to handle the `RootStateModel` size mismatch (240 vs 256 bytes).*

2.  Run the example:
    ```bash
    npx tsc && node main.js
    ```

## Functionality

- Connects to Solana Devnet.
- Initializes Deriverse Engine with Devnet Program ID (`Drvrseg8AQLP8B96DBGmHRjFGviFNYTkHueY9g3k27Gu`) and Version (`12`).
- Sets the client identity to the provided address (`53XAHGz3NdqSvDQ83AaEhV6aR7PWzYaLzrs7fFVHf2Xt`).
- Fetches and logs client data (Points, Trades, etc.).
