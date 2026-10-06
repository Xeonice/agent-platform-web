import type { AppCommand, CommandGroup, CommandSection } from '@/types/command';

const GROUPS: CommandGroup[] = ['需要你处理', '任务', '项目', '前往', '动作'];

function score(command: AppCommand, query: string): number {
  const name = command.name.toLocaleLowerCase();
  if (name === query) return 4;
  if (name.startsWith(query)) return 3;
  if (name.includes(query)) return 2;
  return [command.description, command.group, ...(command.synonyms ?? [])].some((text) =>
    text?.toLocaleLowerCase().includes(query),
  )
    ? 1
    : 0;
}

export function filterCommands(commands: AppCommand[], input: string): CommandSection[] {
  const query = input.trim().toLocaleLowerCase();
  return GROUPS.map((group) => ({
    group,
    matches: commands
      .filter((command) => command.group === group)
      .map((command, index) => ({ command, index, score: query ? score(command, query) : 1 }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index),
  }))
    .filter((section) => section.matches.length > 0)
    .sort((a, b) => (b.matches[0]?.score ?? 0) - (a.matches[0]?.score ?? 0))
    .map(({ group, matches }) => ({ group, items: matches.map(({ command }) => command) }));
}
