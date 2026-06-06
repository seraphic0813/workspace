
  # Project Member Dashboard

  This is a code bundle for Project Member Dashboard. The original project is available at https://www.figma.com/design/MaLwW7Te7JIkoJthvzG090/Project-Member-Dashboard.

  ## Running the code

  Run `pnpm install` (or `npm install`) to install dependencies.

  Run `pnpm dev` (or `npm run dev`) to start the development server.

  ## Tests (adapter)

  A basic test scaffold for the API -> UI adapter is provided at `src/lib/__tests__/evmAdapter.test.ts`.
  The project does not include a test runner by default. To run the TypeScript test file you can either:

  - Install `jest` + `ts-jest` and run via `pnpm jest`, or
  - Install `ts-node` and run directly:

  ```bash
  pnpm add -D ts-node typescript @types/node
  pnpm ts-node src/lib/__tests__/evmAdapter.test.ts
  ```

  The tests are minimal smoke checks intended for developer verification before full unit-test integration.
  