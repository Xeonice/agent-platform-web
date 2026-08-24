import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KnownHostsRowView } from '@/views/settings/KnownHostsRow.view';

const meta: Meta<typeof KnownHostsRowView> = {
  title: 'Settings/KnownHostsRow',
  component: KnownHostsRowView,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof KnownHostsRowView>;

export const WithFingerprints: Story = {
  args: {
    knownHosts: [
      {
        host: 'github.com',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8',
        firstSeenAt: new Date().toISOString(),
      },
      {
        host: 'git.internal.example.com',
        keyType: 'ssh-rsa',
        fingerprint: 'SHA256:abc123def456',
        firstSeenAt: new Date().toISOString(),
      },
    ],
  },
};
