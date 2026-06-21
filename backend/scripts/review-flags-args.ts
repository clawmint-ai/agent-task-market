/**
 * Pure argument parsing for the review-flags CLI, split into its own module so it
 * can be unit-tested WITHOUT importing the service layer (which imports db/pool,
 * which throws at load time when DATABASE_URL is unset — e.g. the CI unit job).
 * No I/O, no imports with side effects. See review-flags.ts for the runner.
 */

export const FLAG_STATUSES = ['open', 'frozen', 'released'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

export type ParsedCommand =
  | { cmd: 'list'; status: FlagStatus }
  | { cmd: 'release'; flagId: string }
  | { cmd: 'confirm'; flagId: string }
  | { cmd: 'error'; message: string };

export const USAGE = [
  'Usage: npm run review-flags -- <command>',
  '  list [open|frozen|released]   list flags (default: open)',
  '  release <flagId>              unfreeze the held reward (return to executor)',
  '  confirm <flagId>              uphold the freeze (credits stay held)',
].join('\n');

/**
 * Map raw argv (after the script name) to a typed command. `release`/`confirm`
 * require a flagId; `list` takes an optional status that must be one of
 * FLAG_STATUSES (defaults to 'open').
 */
export function parseArgs(argv: string[]): ParsedCommand {
  const [cmd, arg] = argv;
  switch (cmd) {
    case 'list': {
      const status = (arg ?? 'open') as FlagStatus;
      if (!FLAG_STATUSES.includes(status)) {
        return { cmd: 'error', message: `invalid status "${arg}" (want: ${FLAG_STATUSES.join('|')})` };
      }
      return { cmd: 'list', status };
    }
    case 'release':
    case 'confirm': {
      if (!arg) return { cmd: 'error', message: `${cmd} requires a <flagId>` };
      return { cmd, flagId: arg };
    }
    default:
      return { cmd: 'error', message: cmd ? `unknown command "${cmd}"` : 'no command given' };
  }
}
