import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SshKeyFormView } from '@/views/settings/SshKeyForm.view';

const noop = (): void => undefined;

const meta: Meta<typeof SshKeyFormView> = {
  title: 'Settings/SshKeyForm',
  component: SshKeyFormView,
  parameters: { layout: 'centered' },
  args: {
    privateKey: '',
    onPrivateKeyChange: noop,
    onTest: noop,
    onSubmit: noop,
    onCancel: noop,
  },
};
export default meta;

type Story = StoryObj<typeof SshKeyFormView>;

export const Empty: Story = { args: { submitDisabled: true } };

export const PassphraseUnsupported: Story = {
  args: {
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n...',
    passphraseWarning: '检测到带 passphrase 的私钥，当前不支持，请改用无口令的密钥。',
    submitDisabled: true,
  },
};

export const Submitting: Story = {
  args: {
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----',
    submitting: true,
  },
};
