import { useEffect } from "react";
import { APP_HOME, BRAND, HOME_SECTIONS } from "../lib/brand.js";
import { BotMessage, Icon, Logo } from "../components/site.jsx";

const FEATURES = [
  ["trophy", "Weekly leaderboard", "Top 5 creators by GMV for the week, on a podium card your creators will want to screenshot.", "Mondays · @here"],
  ["party", "Creator wins", "A milestone card the moment a creator hits their 1st, 3rd, 10th, 30th or 50th sale. Tags only the creator.", "Daily check"],
  ["bolt", "Winning angle of the week", "Last week’s top 3 videos by GMV, with the script, the numbers and how to remake each one.", "Mon–Wed · one a day"],
  ["flame", "Viral hooks", "The most-viewed videos in your niche, any brand, with why the hook worked and how to use it for your product.", "Mon–Wed · one a day"],
  ["chat", "General chat manager", "Answers creator questions in your voice. Anything about payouts, refunds or problems goes to your mods.", "Always on"],
  ["wave", "Creator onboarding", "DMs every new member your questions, links their TikTok handle to your CRM and saves the answers.", "On join"],
];
const STEPS = [
  ["Add your bot", "Give your bot your brand’s name and picture, then add it to your Discord server in two clicks."],
  ["Pick your channels", "Choose where each automation posts. New server? The AI Community Builder creates every channel with the right permissions."],
  ["Connect your CRM", `Paste an API key from Cruva, Euka or Reacher. ${BRAND} reads your creators, videos and sales from there.`],
];
const FLOW = [
  [`${BRAND} drafts the post`, "Numbers from your CRM, cards rendered, copy in your voice"],
  ["Your team reviews it", `In #mod-approvals or in the ${BRAND} inbox, with edits in either place`],
  ["One approval sends it live", `Posted to the right channel, reactions added, logged in ${BRAND}`],
];
const TOP5 = [["@mariah.makes", "$4,812"], ["@thejesscloset", "$3,960"], ["@dailywithdani", "$2,705"], ["@kofi.reviews", "$1,988"], ["@lena.tries", "$1,412"]];
const WAITING = [
  ["Weekly leaderboard", "#leaderboard · Mon 10:00", "Ready", ""],
  ["@kofi.reviews hit 10 sales", "#creator-wins · milestone card", "Ready", ""],
  ["Winning angle #1", "#winning-angles · $2.1k GMV video", "Editing", " line"],
];

export default function Landing({ hash, user }) {
  // #features, #how, … scroll to their section; any other home route starts at the top.
  useEffect(() => {
    const el = HOME_SECTIONS.includes(hash) ? document.getElementById(hash) : null;
    if (el) el.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }, [hash]);

  const start = user ? "#" + APP_HOME : "#signup";

  return (
    <div className="site">
      <header className="k-nav">
        <div className="k-wrap">
          <Logo />
          <nav aria-label="Main">
            <a href="#features">Automations</a>
            <a href="#how">How it works</a>
            <a href="#approvals-info">Approvals</a>
            <a href="#integrations">Integrations</a>
          </nav>
          <div className="k-right">
            {user ? (
              <a className="k-btn primary" href={start}>Open dashboard</a>
            ) : (
              <>
                <a className="k-btn ghost" href="#signin">Sign in</a>
                <a className="k-btn primary" href="#signup">Start free</a>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="k-hero k-wrap">
        <div className="k-badge"><span>New</span>AI Community Builder sets up your Discord in one click</div>
        <h1>Your creator Discord, <em>running itself</em></h1>
        <p className="k-lede">{BRAND} connects your Discord server to your creator CRM. It drafts the weekly leaderboard, celebrates every creator’s first sale and breaks down last week’s best-selling videos. You approve, {BRAND} posts.</p>
        <div className="k-ctas">
          <a className="k-btn primary lg" href={start}>{user ? "Open your dashboard" : "Start free for 14 days"} <Icon name="arrow" /></a>
          <a className="k-btn lg" href="#how">See how it works</a>
        </div>
        <p className="k-fine">Set up in about five minutes. No card needed.</p>

        <div className="k-window" aria-label={BRAND + " product preview"}>
          <div className="k-bar"><i /><i /><i /><span>app.kreo.so / approvals</span></div>
          <div className="k-inner">
            <div className="k-dc">
              <div className="k-chan"><Icon name="hash" size={16} />leaderboard</div>
              <BotMessage time="Today at 10:00 AM">
                <div><span className="k-mention">@here</span> Weekly Top Creators, Nov 2–8. Huge week, team.</div>
                <div className="k-dcard">
                  <h6>Top 5 by GMV</h6>
                  {TOP5.map(([who, gmv], i) => (
                    <div className="k-rank" key={who}><span className="n">{i + 1}</span><b>{who}</b><span className="g">{gmv}</span></div>
                  ))}
                </div>
                <div className="k-reacts"><span>🔥 24</span><span>🤍 18</span><span>🚀 15</span><span>📈 11</span></div>
              </BotMessage>
            </div>
            <div className="k-panel">
              <div className="k-panel-head"><h4>Waiting on you</h4><span className="k-pill rose">3 drafts</span></div>
              {WAITING.map(([title, where, state, cls]) => (
                <div className="k-row" key={title}><div><b>{title}</b>{where}</div><span className={"k-pill" + cls}>{state}</span></div>
              ))}
              <div className="k-actions">
                <span className="k-btn primary sm">Approve &amp; post</span>
                <span className="k-btn sm">Edit</span>
              </div>
              <p className="k-note">Your moderators can also approve right inside Discord.</p>
            </div>
          </div>
        </div>
        <p className="k-fine">Example data</p>
      </section>

      <section className="k-works" id="integrations">
        <div className="k-wrap">
          <p>Plugs into the tools your team already uses</p>
          <div className="k-marks"><span>Discord</span><span>TikTok Shop</span><span>Cruva</span><span>Euka</span><span>Reacher</span></div>
        </div>
      </section>

      <section className="k-section" id="features">
        <div className="k-wrap">
          <div className="k-sec-head">
            <div className="k-eyebrow">Automations</div>
            <h2>Six automations that keep creators posting</h2>
            <p>Each one pulls live numbers from your CRM and drafts a post in your brand’s voice. Nothing goes live until someone on your team approves it.</p>
          </div>
          <div className="k-grid3">
            {FEATURES.map(([icon, title, body, when]) => (
              <div className="k-feature" key={title}>
                <div className="k-fi"><Icon name={icon} /></div>
                <h3>{title}</h3>
                <p>{body}</p>
                <div className="k-when">{when}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="k-section alt" id="how">
        <div className="k-wrap">
          <div className="k-sec-head">
            <div className="k-eyebrow">How it works</div>
            <h2>Live in three steps</h2>
            <p>Sign up, then the setup guide walks you through each one. Your dashboard unlocks when you’re done.</p>
          </div>
          <div className="k-steps3">
            {STEPS.map(([title, body], i) => (
              <div className="k-step3" key={title}><div className="k-num">Step {i + 1}</div><h3>{title}</h3><p>{body}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="k-band" id="approvals-info">
        <div className="k-wrap">
          <div>
            <div className="k-eyebrow">Two-way approvals</div>
            <h2>Approve in Discord or in {BRAND}. It posts once.</h2>
            <p>Every draft lands in your private mod channel and in your {BRAND} inbox at the same time. Whoever approves first sends it live. The other copy updates itself, so nothing posts twice.</p>
          </div>
          <div className="k-flow">
            {FLOW.map(([title, body], i) => (
              <div className="k-f" key={title}><i>{i + 1}</i><div><b>{title}</b><span>{body}</span></div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="k-section k-cta">
        <div className="k-wrap">
          <h2>Give your creators a reason to open Discord</h2>
          <p>Start free, add your bot and see your first draft today.</p>
          <a className="k-btn primary lg" href={start}>{user ? "Open dashboard" : "Start free"} <Icon name="arrow" /></a>
        </div>
      </section>

      <footer className="k-foot">
        <div className="k-wrap">
          <Logo />
          <nav aria-label="Footer">
            <a href="#features">Automations</a>
            <a href="#how">How it works</a>
            <a href="#integrations">Integrations</a>
            {user ? <a href={start}>Dashboard</a> : <><a href="#signin">Sign in</a><a href="#signup">Sign up</a></>}
          </nav>
          <span>© 2026 {BRAND}</span>
        </div>
      </footer>
    </div>
  );
}
