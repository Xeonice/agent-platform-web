export type CommandGroup = '需要你处理' | '任务' | '项目' | '前往' | '动作';

export interface AppCommand {
  id: string;
  name: string;
  description?: string;
  group: CommandGroup;
  synonyms?: string[];
  disabledReason?: string;
  execute: () => void;
}

export interface CommandSection {
  group: CommandGroup;
  items: AppCommand[];
}
