import { useEffect, useState } from "react";
import { api } from "../services/api.js";
import { Icon, Logo } from "../components/site.jsx";

const POINTS = [
  "Brands find you by niche, level and sales",
  "They reach out to you here on Discord",
  "Free samples, collabs and paid campaigns",
  "Leave any time with the same link",
];
const ORDER = ["tiktok", "niche", "country", "consent"];

/**
 * The page behind the "Join KREO" button in KREO's DM (#join/<token>). No account: the signed link
 * already says who they are on Discord. They link their TikTok, pick a niche and agree to be found.
 */
export default function Join({ token }) {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState({ tiktok: "", niche: "", country: "", consent: false });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // "joined" | "updated" | "left"
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    api("GET", "/join/" + encodeURIComponent(token)).then((r) => {
      setInfo(r);
      if (r.profile) setValues({ tiktok: r.profile.tiktok ? "@" + r.profile.tiktok : "", niche: r.profile.niche || "", country: r.profile.country || "", consent: Boolean(r.profile.consent) });
    }).catch((e) => setLoadError(e.message));
  }, [token]);

  const set = (field) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setValues((x) => ({ ...x, [field]: v }));
    if (errors[field]) setErrors((x) => ({ ...x, [field]: "" }));
    if (formError) setFormError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = {};
    if (!values.tiktok.trim().replace(/^@/, "")) errs.tiktok = "Enter your TikTok username.";
    if (!values.niche) errs.niche = "Pick what you mostly post about.";
    if (!values.country) errs.country = "Pick the country you sell in.";
    if (!values.consent) errs.consent = "Tick the box so brands can find you.";
    setErrors(errs);
    const first = ORDER.find((f) => errs[f]);
    if (first) return document.getElementById("j-" + first)?.focus();
    setBusy(true);
    try {
      const was = info.profile;
      const r = await api("POST", "/join/" + encodeURIComponent(token), values);
      setInfo(r);
      setDone(was ? "updated" : "joined");
      setEditing(false);
    } catch (err) {
      if (err.field) {
        setErrors({ [err.field]: err.message });
        document.getElementById("j-" + err.field)?.focus();
      } else setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (busy || !confirm("Leave KREO? Brands won’t be able to find you any more.")) return;
    setBusy(true);
    try {
      setInfo(await api("POST", "/join/" + encodeURIComponent(token), { leave: true }));
      setDone("left");
      setValues((v) => ({ ...v, consent: false }));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const who = info?.creator;
  const joined = Boolean(info?.profile) && done !== "left";
  const showForm = info && (!joined || editing);

  let body;
  if (loadError) {
    body = <><h1>This link doesn’t work</h1><p className="k-sub">{loadError}</p></>;
  } else if (!info) {
    body = <p className="k-sub" aria-busy="true">Loading…</p>;
  } else if (done === "left") {
    body = <><h1>You’ve left KREO</h1><p className="k-sub">Brands can’t find you through KREO any more. Changed your mind? Fill in the form again with this same link.</p><button className="k-btn primary lg wide" type="button" onClick={() => setDone(null)}>Join again</button></>;
  } else if (joined && !editing) {
    const p = info.profile;
    body = (
      <>
        <h1>{done === "joined" ? "You’re in! 🎉" : done === "updated" ? "Saved" : "You’re on KREO"}</h1>
        <p className="k-sub">{done === "joined" ? "Brands looking for creators like you can now find you and message you on Discord. KREO also sent you a confirmation in your DMs." : "This is what brands see when they search for creators."}</p>
        <div className="j-card">
          <Person who={who} />
          <dl>
            <div><dt>TikTok</dt><dd>@{p.tiktok}</dd></div>
            <div><dt>Niche</dt><dd>{p.niche}</dd></div>
            <div><dt>Country</dt><dd>{info.countries.find(([c]) => c === p.country)?.[1] || p.country}</dd></div>
          </dl>
        </div>
        <div className="j-row">
          <button className="k-btn lg" type="button" onClick={() => setEditing(true)}>Edit details</button>
          <button className="k-btn lg subtle" type="button" disabled={busy} onClick={leave}>Leave KREO</button>
        </div>
        <p className="k-switch">You can close this page now.</p>
      </>
    );
  } else {
    body = (
      <>
        <h1>{editing ? "Edit your details" : "Join KREO"}</h1>
        <p className="k-sub">{info.server ? <>You were invited from <b>{info.server}</b>. </> : null}Link your TikTok so brands can find you. Takes 30 seconds.</p>
        {who?.name && <div className="j-card"><Person who={who} note="Your Discord account" /></div>}
        <form className="k-form" onSubmit={submit} noValidate>
          {formError && <p className="k-formerr" role="alert">{formError}</p>}
          <label className="k-field">
            TikTok username
            <input id="j-tiktok" className="k-input" placeholder="@yourname" autoComplete="off" autoCapitalize="none" spellCheck={false} value={values.tiktok} onChange={set("tiktok")} aria-invalid={errors.tiktok ? true : undefined} aria-describedby={errors.tiktok ? "err-tiktok" : undefined} autoFocus />
            {errors.tiktok && <span className="k-err" id="err-tiktok" role="alert">{errors.tiktok}</span>}
          </label>
          <label className="k-field">
            What do you mostly post about?
            <select id="j-niche" className="k-input" value={values.niche} onChange={set("niche")} aria-invalid={errors.niche ? true : undefined}>
              <option value="">Pick one</option>
              {info.niches.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {errors.niche && <span className="k-err" role="alert">{errors.niche}</span>}
          </label>
          <label className="k-field">
            Country you sell in
            <select id="j-country" className="k-input" value={values.country} onChange={set("country")} aria-invalid={errors.country ? true : undefined}>
              <option value="">Pick one</option>
              {info.countries.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
            </select>
            {errors.country && <span className="k-err" role="alert">{errors.country}</span>}
          </label>
          <label className={"j-consent" + (errors.consent ? " bad" : "")}>
            <input id="j-consent" type="checkbox" checked={values.consent} onChange={set("consent")} />
            <span>Brands on KREO can see my TikTok username, niche, country and TikTok Shop sales numbers, and message me on Discord about working together.</span>
          </label>
          {errors.consent && <span className="k-err" role="alert">{errors.consent}</span>}
          <button className="k-btn primary lg wide" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : editing ? "Save" : "Join KREO"}</button>
          {editing && <button className="k-btn lg wide subtle" type="button" onClick={() => setEditing(false)}>Cancel</button>}
        </form>
      </>
    );
  }

  return (
    <div className="site k-auth">
      <div className="k-formside">
        <Logo href="#home" />
        <div className="k-formbox">{body}</div>
      </div>
      <aside className="k-art">
        <h2>Get found by brands that fit you</h2>
        <ul>{POINTS.map((p) => <li key={p}><Icon name="check" /><span>{p}</span></li>)}</ul>
        {showForm && <p className="j-small">We only use your TikTok username to look up your public TikTok Shop sales with brands you work with. We never post anything for you.</p>}
      </aside>
    </div>
  );
}

function Person({ who, note }) {
  return (
    <div className="j-person">
      <span className="j-av">{who?.avatar ? <img src={who.avatar} alt="" /> : (who?.name || "?").slice(0, 1).toUpperCase()}</span>
      <div style={{ minWidth: 0 }}><b>{who?.name || "You"}</b><span>{note || (who?.user ? "@" + who.user + " on Discord" : "On Discord")}</span></div>
    </div>
  );
}
