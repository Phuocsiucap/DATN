import { FileText } from 'lucide-react'

const sections = [
  {
    title: '1. Acceptance of terms',
    body: [
      'By accessing or using SocialContentHub, you agree to these Terms of Service. If you do not agree, you should not use the service.',
      'SocialContentHub is a content operations platform for collecting content signals, planning social posts, generating media workflows, reviewing drafts, and scheduling publication tasks.',
    ],
  },
  {
    title: '2. User responsibilities',
    body: [
      'You are responsible for the content, accounts, credentials, media, prompts, schedules, and publishing decisions you manage through the service.',
      'You must only connect social media accounts that you own or are authorized to manage, and you must follow the terms and policies of each connected platform.',
    ],
  },
  {
    title: '3. Content and platform use',
    body: [
      'SocialContentHub may help organize source material, generate drafts, prepare video production workflows, and queue content for review. You remain responsible for verifying accuracy, legality, permissions, and suitability before publication.',
      'The service must not be used to create spam, deceptive content, infringing content, unlawful material, or activity that violates third-party platform rules.',
    ],
  },
  {
    title: '4. Account security',
    body: [
      'You are responsible for keeping your login credentials and connected account access secure. Notify the operator of the service if you believe your account has been accessed without authorization.',
      'We may suspend access if we detect activity that may harm the service, other users, or connected platforms.',
    ],
  },
  {
    title: '5. Service availability',
    body: [
      'The service is provided on an as-available basis. We may update, pause, or discontinue features as needed for maintenance, security, or product changes.',
      'We do not guarantee that generated content, crawled data, third-party APIs, or publishing integrations will always be available, complete, or error-free.',
    ],
  },
  {
    title: '6. Limitation of liability',
    body: [
      'To the maximum extent permitted by law, SocialContentHub is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the service.',
      'You agree to use the service at your own discretion and to review all content and automation settings before relying on them.',
    ],
  },
  {
    title: '7. Changes to these terms',
    body: [
      'We may update these Terms of Service from time to time. The latest version will be posted on this page with the updated date.',
    ],
  },
]

export default function TermsPage() {
  return (
    <main className="h-full w-full overflow-y-auto bg-[var(--surface)] p-3 text-[var(--on-surface)]">
      <div className="w-full">
        <header className="mb-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-md bg-[var(--surface-variant)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-strong)]">
            <FileText size={14} />
            <span>Legal</span>
          </div>
          <h1 className="text-3xl font-extrabold text-[var(--on-surface)] sm:text-4xl">SocialContentHub Terms of Service</h1>
          <p className="mt-4 text-lg leading-7 text-[var(--on-surface-variant)]">
            Rules for using SocialContentHub and connected content workflows.
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
