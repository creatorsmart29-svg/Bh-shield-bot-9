import type { Message } from "discord.js";

export type RegisteredCommandContext = {
  prefix: string;
  noPrefix: boolean;
  ownerId?: string;
  isOwner: boolean;
};

export type RegisteredCommandHandler = (
  message: Message,
  args: string[],
  context: RegisteredCommandContext,
) => Promise<void | boolean>;

export type RegisteredCommand = {
  name: string;
  aliases?: string[];
  guildOnly?: boolean;
  ownerOnly?: boolean;
  description?: string;
  usage?: string;
  permissions?: string[];
  category?: string;
  execute: RegisteredCommandHandler;
};

const registry = new Map<string, RegisteredCommand>();

/**
 * Register one command implementation. A command module should call this once
 * during initialization; the message router never needs to know its name.
 *
 * Once registered, the command automatically supports the configured prefix,
 * custom guild prefixes, owner No Prefix, and owner DM execution.
 */
export function registerCommand(command: RegisteredCommand): void {
  const names = [command.name, ...(command.aliases ?? [])];
  for (const name of names) {
    const normalized = normalizeCommandName(name);
    if (!normalized) throw new Error("Cannot register an empty command name.");
    registry.set(normalized, command);
  }
}

export function registerCommands(commands: RegisteredCommand[]): void {
  for (const command of commands) registerCommand(command);
}

/**
 * Convenience adapter for command modules that expose one handler for several
 * command names. The resulting entries are still stored in the same registry.
 */
export function registerCommandNames(
  names: Iterable<string>,
  create: (name: string) => Omit<RegisteredCommand, "name"> & { name?: string } = () => ({ execute: async () => undefined }),
): void {
  for (const name of names) {
    const command = create(name);
    registerCommand({ ...command, name: command.name ?? name });
  }
}

export function getRegisteredCommand(name: string): RegisteredCommand | undefined {
  return registry.get(normalizeCommandName(name));
}

export function isRegisteredCommand(name: string): boolean {
  return Boolean(getRegisteredCommand(name));
}

export function getRegisteredCommandNames(): string[] {
  return [...new Set([...registry.values()].map((command) => command.name))];
}

export function getRegisteredCommands(): RegisteredCommand[] {
  return [...new Set(registry.values())];
}

export function clearCommandRegistry(): void {
  registry.clear();
}

export async function executeRegisteredCommand(
  message: Message,
  commandName: string,
  args: string[],
  context: RegisteredCommandContext,
): Promise<boolean> {
  const command = getRegisteredCommand(commandName);
  if (!command) return false;
  if (command.guildOnly && !message.guild) {
    await message.reply(`The \`${command.name}\` command requires a server context. Run it in a server where BH SHIELD is installed.`);
    return true;
  }
  if (command.ownerOnly && !context.isOwner) {
    await message.reply("Access Denied. Only the bot owner can use this command.");
    return true;
  }
  await command.execute(message, args, context);
  return true;
}

function normalizeCommandName(name: string): string {
  return name.trim().toLowerCase();
}