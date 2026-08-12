// Storybook Vitest addon setup（12 §2.3）：把 preview 注解注入到浏览器测试运行时。
import { beforeAll } from 'vitest';
import { setProjectAnnotations } from '@storybook/nextjs-vite';
import * as previewAnnotations from './preview';

const project = setProjectAnnotations([previewAnnotations]);

beforeAll(project.beforeAll);
