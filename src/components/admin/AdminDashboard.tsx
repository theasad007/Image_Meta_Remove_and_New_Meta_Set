"use client";

import type { AdminAccountRow, AdminDirectoryTotals } from "../../lib/firebase/directory";
import Link from "next/link";

/**
 * Screen 08 overview tab. Every number visible here is REAL directory
 * data (server count queries + the loaded directory page). File counts,
 * sizes, success rates, activity, and breakdowns are never fabricated:
 * image processing happens privately in each user's browser, so those
 * cards and panels show an honest "Not collected" state instead.
 */

function AdminEmptyState({
  tone,
  icon,
  title,
  children,
}: {
  tone: "blue" | "slate";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const tint = tone === "blue"
    ? "bg-[#e9f2fe] text-[#2d5be9]"
    : "bg-slate-100 text-[#5a6b85]";
  return (
    <div className="grid place-items-center px-4 py-7 text-center">
      <span aria-hidden="true" className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tint}`}>
        <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <p className="mt-3 text-[13px] font-bold text-[#16244a]">{title}</p>
      <p className="mt-1 max-w-sm text-[11.5px] leading-5 text-[#5a6b85]">{children}</p>
    </div>
  );
}

const EMPTY_ICONS = {
  chart: <path d="M4 20h16M6.5 16.5v-4M11 16.5V8.5M15.5 16.5v-6M20 16.5V5.5M4 20h16" />,
  pie: <path d="M12 4a8 8 0 1 1-8 8h8V4Zm1 2v6h6a8 8 0 0 0-6-6Z" />,
  activity: <path d="M4.5 12h4L11 6l2.5 12L16 12h3.5" />,
  processing: <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5M12 3.5A8.5 8.5 0 0 1 20.5 12M12 7.5a4.5 4.5 0 1 0 4.5 4.5A4.5 4.5 0 0 0 12 7.5Zm0 4.5h8.5" />,
};

function MetricCardSkeleton() {
  return (
    <div className="surface-card rounded-2xl p-4" data-testid="admin-metric-skeleton" aria-hidden="true">
      <span className="block h-9 w-9 animate-pulse rounded-xl bg-slate-100" />
      <span className="mt-3 block h-6 w-24 animate-pulse rounded-lg bg-slate-100" />
      <span className="mt-2 block h-3.5 w-28 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

function NotCollectedMetric({ label, testid }: { label: string; testid: string }) {
  return (
    <div className="surface-card rounded-2xl p-4" data-testid={testid}>
      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {EMPTY_ICONS.chart}
        </svg>
      </span>
      <p className="mt-3 text-[19px] font-bold leading-7 text-slate-400">—</p>
      <p className="text-[12px] font-semibold text-[#43536e]">{label}</p>
      <p className="mt-1 text-[10.5px] leading-4 text-[#5a6b85]">Not collected — processing stays private.</p>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function initialAvatar(name: string, email: string): { text: string; tone: string } {
  const source = name.trim() || email.trim();
  const first = source.charAt(0);
  const second = name.trim().includes(" ") ? name.trim().split(/\s+/)[1]?.charAt(0) ?? "" : "";
  const text = `${first}${second}`.toUpperCase() || "?";
  const tones = ["bg-[#e5f0fd] text-[#2d5be9]", "bg-[#e0f5ee] text-[#0d9474]", "bg-[#fdeee5] text-[#b3531f]", "bg-[#f3eafd] text-[#7a3fc2]", "bg-[#eef2f7] text-[#5a6b85]"];
  const hash = [...source].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 997, 0);
  return { text, tone: tones[hash % tones.length] };
}

function formatRegistered(createdAt: unknown): string {
  const seconds = (createdAt as { seconds?: number } | null | undefined)?.seconds;
  if (typeof seconds !== "number") return "—";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(seconds * 1000));
}

function RecentUsersCard({ rows, onViewAll }: { rows: AdminAccountRow[]; onViewAll: () => void }) {
  const recent = rows.slice(0, 5);
  return (
    <section aria-labelledby="admin-recent-users-heading" data-testid="admin-recent-users" className="surface-card rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-2">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e9f2fe] text-[#2d5be9]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15.5 19.5v-1.2a3.2 3.2 0 0 0-3.2-3.2H7.2A3.2 3.2 0 0 0 4 18.3v1.2M9.7 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM20 18.3v-1.1a3.2 3.2 0 0 0-2.4-3.1" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="admin-recent-users-heading" className="text-[14.5px] font-bold text-[#16244a]">Recent users</h2>
          <p className="mt-0.5 text-[11px] text-[#5a6b85]">Most recently registered accounts, newest first (directory, not the Auth user list)</p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          data-testid="admin-view-all-users"
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-[12px] font-bold text-[#2d5be9] hover:text-[#2343af]"
        >
          View all users
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-[11.5px] leading-5 text-[#5a6b85]">
          No registered accounts yet — accounts appear here after their first Google sign-in.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-left text-[12px]">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#8296b8]">
                <th scope="col" className="pb-1.5 pr-2 font-bold">User</th>
                <th scope="col" className="hidden pb-1.5 pr-2 font-bold sm:table-cell">Email</th>
                <th scope="col" className="pb-1.5 pr-2 font-bold">Registered</th>
                <th scope="col" className="pb-1.5 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f8]">
              {recent.map((row) => {
                const identity = initialAvatar(row.displayName, row.email);
                return (
                  <tr key={row.uid} className="align-middle">
                    <td className="py-2 pr-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${identity.tone}`}>
                          {identity.text}
                        </span>
                        <span className="max-w-[9rem] truncate font-semibold text-[#16244a]">{row.displayName || "(no display name)"}</span>
                      </span>
                    </td>
                    <td className="hidden max-w-[11rem] truncate py-2 pr-2 text-[#5a6b85] sm:table-cell">{row.email || "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-2 text-[#43536e]">{formatRegistered(row.createdAt)}</td>
                    <td className="py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 ${row.status === "active" ? "bg-[#e0f5ee] text-[#0b5f4c]" : "bg-red-50 text-red-700"}`}>
                        {row.status === "active" ? "Active" : "Suspended"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuickActions({ onViewAllUsers, onOpenSettings }: { onViewAllUsers: () => void; onOpenSettings: () => void }) {
  const tiles = [
    {
      title: "Manage users",
      subtitle: "Directory, statuses and suspension",
      action: onViewAllUsers,
      icon: <path d="M15.5 19.5v-1.2a3.2 3.2 0 0 0-3.2-3.2H7.2A3.2 3.2 0 0 0 4 18.3v1.2M9.7 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM20 18.3v-1.1a3.2 3.2 0 0 0-2.4-3.1M15.6 4.4a3.6 3.6 0 0 1 0 6.9" />,
      testid: "admin-action-users",
    },
    {
      title: "Usage policy & settings",
      subtitle: "Unlimited by default — honest notice",
      action: onOpenSettings,
      icon: <path d="m14.5 4 .6 1.9 1.9.6 1.9-.6 1 1.8-1.1 1.6.6 1.8 1.6 1.2-1 1.8-1.9-.3-1.5 1.2-.2 2h-2l-.2-2-1.5-1.2-1.9.3-1-1.8L11.8 12l-.5-1.8L9.7 9l1-1.8 1.9.6 1.5-1.2.2-2h2Zm-1 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />,
      testid: "admin-action-settings",
    },
    {
      title: "Image workspace",
      subtitle: "Open the public cleaner at home",
      href: "/#tools",
      icon: <path d="M12 4.5 19.5 10a1 1 0 0 1 .4.8v7.2a1.5 1.5 0 0 1-1.5 1.5H15v-5h-3v5H6.6a1.5 1.5 0 0 1-1.5-1.5v-7.2a1 1 0 0 1 .4-.8L12 4.5Z" />,
      testid: "admin-action-workspace",
    },
    {
      title: "Visit public site",
      subtitle: "Homepage and support matrix",
      href: "/",
      icon: <path d="M14 4.5h5.5V10M19.2 4.8 11 13M18 13.8v4.2a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H11" />,
      testid: "admin-action-site",
    },
  ];
  return (
    <section aria-labelledby="admin-quick-actions-heading" className="surface-card rounded-2xl p-4 sm:p-5">
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e9f2fe] text-[#2d5be9]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4.5h5.5V10M19.2 4.8 11 13M18 13.8v4.2a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H11" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="admin-quick-actions-heading" className="text-[14.5px] font-bold text-[#16244a]">Quick actions</h2>
          <p className="mt-0.5 text-[11px] text-[#5a6b85]">Only real destinations — nothing invented</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {tiles.map((tile) => {
          const iconAndText = (
            <>
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#eef4ff] text-[#3157d5]">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {tile.icon}
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-bold leading-4 text-[#16244a]">{tile.title}</span>
                <span className="mt-0.5 block text-[10.5px] leading-3.5 text-[#5a6b85]">{tile.subtitle}</span>
              </span>
              <span aria-hidden="true" className="ml-auto shrink-0 text-[#8296b8]">›</span>
            </>
          );
          const className = "flex w-full items-center gap-2.5 rounded-xl border border-[#e6ebf3] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#9db4f2] hover:bg-[#f8faff]";
          return tile.href ? (
            <Link key={tile.testid} href={tile.href} data-testid={tile.testid} className={className}>{iconAndText}</Link>
          ) : (
            <button key={tile.testid} type="button" data-testid={tile.testid} onClick={tile.action} className={className}>{iconAndText}</button>
          );
        })}
      </div>
    </section>
  );
}

export default function AdminDashboard({
  totals,
  totalsLoading,
  recent,
  directoryLoading,
  refreshedAt,
  onViewAllUsers,
  onOpenSettings,
}: {
  totals: AdminDirectoryTotals | null;
  totalsLoading: boolean;
  /** Genuinely newest registrations (server createdAt-desc query), null until loaded. */
  recent: AdminAccountRow[] | null;
  directoryLoading: boolean;
  /** Stamp from the parent when real directory data was last fetched. */
  refreshedAt: string | null;
  onViewAllUsers: () => void;
  onOpenSettings: () => void;
}) {
  const active = totals ? totals.total - totals.suspended : null;

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0">
          <h1 data-testid="admin-welcome" className="text-[19px] font-bold tracking-[-0.01em] text-[#16244a] sm:text-[21px]">
            Welcome back, Super Admin
          </h1>
          <p className="mt-1 text-[12.5px] leading-5 text-[#5a6b85]">
            Manage registered users and monitor the administrative health of your platform.
          </p>
        </div>
        <p role="status" data-testid="admin-refreshed" className="ml-auto rounded-xl border border-[#e6ebf3] bg-white px-3 py-2 text-[11px] font-semibold text-[#43536e]">
          Directory totals are live · refreshed {refreshedAt ?? "…"}
        </p>
      </div>

      {/* Metric cards: 3 real directory metrics + 2 honest uncollected slots. */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        {totalsLoading ? <MetricCardSkeleton /> : (
          <div className="surface-card rounded-2xl p-4" data-testid="admin-metric-users">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e5f0fd] text-[#2d5be9]">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12Zm7 8.5a7 7 0 0 0-14 0" />
              </svg>
            </span>
            <p className="mt-3 text-[21px] font-bold leading-7 text-[#16244a]">{totals ? formatNumber(totals.total) : "—"}</p>
            <p className="text-[12px] font-semibold text-[#43536e]">Registered users</p>
            <p className="mt-1 text-[10.5px] leading-4 text-[#5a6b85]">Accounts with a Firestore directory record.</p>
          </div>
        )}
        {totalsLoading ? <MetricCardSkeleton /> : (
          <div className="surface-card rounded-2xl p-4" data-testid="admin-metric-active">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0f5ee] text-[#0d9474]">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 12.5 3.5 3.5L18 8M12.5 20a8 8 0 1 1 8-8" />
              </svg>
            </span>
            <p className="mt-3 text-[21px] font-bold leading-7 text-[#16244a]">{active === null ? "—" : formatNumber(active)}</p>
            <p className="text-[12px] font-semibold text-[#43536e]">Enabled accounts</p>
            <p className="mt-1 text-[10.5px] leading-4 text-[#5a6b85]">Full access to signed-in cloud features.</p>
          </div>
        )}
        {totalsLoading ? <MetricCardSkeleton /> : (
          <div className="surface-card rounded-2xl p-4" data-testid="admin-metric-suspended">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fdeee5] text-[#b3531f]">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 7.5A4.5 4.5 0 1 0 12 16.5 4.5 4.5 0 0 0 12 7.5Zm0-3.5a8 8 0 1 1-8 8m8-8a8 8 0 0 1 0 16ZM4 20 20 4" />
              </svg>
            </span>
            <p className="mt-3 text-[21px] font-bold leading-7 text-[#16244a]">{totals ? formatNumber(totals.suspended) : "—"}</p>
            <p className="text-[12px] font-semibold text-[#43536e]">Suspended from cloud features</p>
            <p className="mt-1 text-[10.5px] leading-4 text-[#5a6b85]">Google login and browser-only cleaning stay available.</p>
          </div>
        )}
        <NotCollectedMetric label="Files processed" testid="admin-metric-notcollected-files" />
        <NotCollectedMetric label="Clean success rate" testid="admin-metric-notcollected-success" />
      </div>

      {/* Charts: honest, real-sized cards. */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <section aria-labelledby="admin-usage-heading" className="surface-card min-w-0 rounded-2xl p-4 sm:p-5 lg:col-span-2">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e9f2fe] text-[#2d5be9]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {EMPTY_ICONS.chart}
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="admin-usage-heading" className="text-[14.5px] font-bold text-[#16244a]">Usage overview</h2>
              <p className="mt-0.5 text-[11px] text-[#5a6b85]">Files processed platform-wide</p>
            </div>
          </div>
          <AdminEmptyState tone="blue" icon={EMPTY_ICONS.chart} title="No processing statistics exist">
            Image processing statistics are not collected because files are processed privately on each user&apos;s
            device. Nothing is ever uploaded, metered or observed — the browser-only cleaner works without accounts.
          </AdminEmptyState>
        </section>
        <section aria-labelledby="admin-formats-heading" className="surface-card rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4ff] text-[#3157d5]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {EMPTY_ICONS.pie}
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="admin-formats-heading" className="text-[14.5px] font-bold text-[#16244a]">File formats</h2>
              <p className="mt-0.5 text-[11px] text-[#5a6b85]">Distribution of processed files</p>
            </div>
          </div>
          <AdminEmptyState tone="slate" icon={EMPTY_ICONS.pie} title="Format breakdown is not collected">
            Format usage never leaves the browser, so no aggregate exists. Check the
            {" "}
            <Link href="/#formats" className="font-semibold text-[#2d5be9] underline-offset-2 hover:underline">public file-support matrix</Link>
            {" "}for everything the app handles.
          </AdminEmptyState>
        </section>
      </div>

      {/* Tables row: real users, honest activity. */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <RecentUsersCard rows={recent ?? []} onViewAll={onViewAllUsers} />
          {directoryLoading ? (
            <p role="status" className="mt-2 text-[11px] font-semibold text-[#5a6b85]" data-testid="admin-directory-loading">Loading directory…</p>
          ) : null}
        </div>
        <section aria-labelledby="admin-activity-heading" className="surface-card rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4ff] text-[#3157d5]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {EMPTY_ICONS.activity}
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="admin-activity-heading" className="text-[14.5px] font-bold text-[#16244a]">Recent activity</h2>
              <p className="mt-0.5 text-[11px] text-[#5a6b85]">Processing events</p>
            </div>
          </div>
          <AdminEmptyState tone="slate" icon={EMPTY_ICONS.activity} title="Per-file activity is not logged">
            Every visit is guest-capable and processing is private on-device, so the platform has no per-file event
            log to show. Only account-directory changes are visible to administrators.
          </AdminEmptyState>
        </section>
      </div>

      {/* Lower row: honest breakdowns + real actions. */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <section aria-labelledby="admin-filetypes-heading" className="surface-card rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4ff] text-[#3157d5]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {EMPTY_ICONS.pie}
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="admin-filetypes-heading" className="text-[14.5px] font-bold text-[#16244a]">Top file types by users</h2>
              <p className="mt-0.5 text-[11px] text-[#5a6b85]">Most commonly processed formats</p>
            </div>
          </div>
          <AdminEmptyState tone="slate" icon={EMPTY_ICONS.pie} title="No format totals exist">
            The app never counts which formats individual users process, so a leaderboard would be invented data.
          </AdminEmptyState>
        </section>
        <section aria-labelledby="admin-results-heading" className="surface-card rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e0f5ee] text-[#0d9474]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {EMPTY_ICONS.processing}
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="admin-results-heading" className="text-[14.5px] font-bold text-[#16244a]">Processing results</h2>
              <p className="mt-0.5 text-[11px] text-[#5a6b85]">Success vs failed files</p>
            </div>
          </div>
          <AdminEmptyState tone="slate" icon={EMPTY_ICONS.processing} title="Results stay on the user's device">
            Verification runs locally in the browser and individual clean results are never sent to administrators,
            so there is no success/failure total to display.
          </AdminEmptyState>
        </section>
        <QuickActions onViewAllUsers={onViewAllUsers} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
