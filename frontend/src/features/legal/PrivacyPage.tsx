import { ShieldCheck } from 'lucide-react'

const sections = [
  {
    title: '1. Information we collect',
    body: [
      'SocialContentHub may collect account information such as email address, user roles, connected social profile names, workflow settings, content drafts, source URLs, media metadata, and usage activity within the service.',
      'When you connect TikTok or another social platform, we may process the authorization data needed to authenticate the account and operate requested features.',
    ],
  },
  {
    title: '2. How we use information',
    body: [
      'We use information to provide login, account management, content planning, media workflow generation, review, scheduling, analytics, and publishing-related features.',
      'We may also use technical logs to maintain security, debug issues, prevent abuse, and improve reliability.',
    ],
  },
  {
    title: '3. TikTok data',
    body: [
      'If you authorize TikTok Login Kit or TikTok API access, we use TikTok data only to provide the features you requested, such as identifying the connected account and enabling authorized content workflows.',
      'We do not sell TikTok user data. We only share data when required to operate the service, comply with law, protect the service, or with your direction.',
    ],
  },
  {
    title: '4. Data retention',
    body: [
      'We retain information for as long as needed to provide the service, maintain records, resolve disputes, enforce terms, and comply with legal obligations.',
      'You may request deletion of account-related information where applicable by contacting the service operator.',
    ],
  },
  {
    title: '5. Security',
    body: [
      'We use reasonable technical and organizational measures to protect information. No online service can guarantee absolute security.',
      'You should protect your account credentials and only grant access to social accounts you are authorized to manage.',
    ],
  },
  {
    title: '6. Third-party services',
    body: [
      'The service may integrate with third-party platforms such as TikTok, content sources, service providers, storage systems, and publishing services. Their privacy practices are governed by their own policies.',
    ],
  },
  {
    title: '7. Contact',
    body: [
      'For privacy questions or data requests, contact the operator of SocialContentHub through the official website or administrative contact provided with the service.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <main className="h-full w-full overflow-y-auto bg-[var(--surface)] p-3 text-[var(--on-surface)]">
      <div className="w-full">
        <header className="mb-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-md bg-[var(--surface-variant)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-strong)]">
            <ShieldCheck size={14} />
            <span>Privacy</span>
          </div>
          <h1 className="text-3xl font-extrabold text-[var(--on-surface)] sm:text-4xl">SocialContentHub Privacy Policy</h1>
          <p className="mt-4 text-lg leading-7 text-[var(--on-surface-variant)]">
            How SocialContentHub handles account, workflow, and connected platform data.
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--on-surface-variant)]">Last updated: August 25, 2026</p>
        </header>

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-bold text-[var(--on-surface)]">{section.title}</h2>
              <div className="mt-4 space-y-4 text-base leading-7 text-[var(--on-surface-variant)]">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-8 pt-4 text-sm text-[var(--on-surface-variant)]">
          <p>SocialContentHub is a social media content management and automation workspace.</p>
          <div className="mt-4 flex flex-wrap gap-4">
            <a className="font-semibold text-[var(--accent-strong)] hover:underline" href="/terms">
              Terms
            </a>
            <a className="font-semibold text-[var(--accent-strong)] hover:underline" href="/privacy">
              Privacy
            </a>
          </div>
        </footer>
      </div>
    </main>
  )
}
