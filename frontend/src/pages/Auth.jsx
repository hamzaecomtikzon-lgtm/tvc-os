import { useEffect, useRef, useState } from "react";
import { auth, validate } from "../services/auth.js";
import { BRAND } from "../lib/brand.js";
import { BotMessage, GoogleMark, Icon, Logo } from "../components/site.jsx";

const COPY = {
  signup: {
    title: `Create your ${BRAND} account`,
    sub: "14 days free. Set up your community in about five minutes.",
    submit: "Create account",
    busy: "Creating account…",
  },
  signin: {
    title: "Welcome back",
    sub: `Sign in to your ${BRAND} workspace.`,
    submit: "Sign in",
    busy: "Signing in…",
  },
};
const POINTS = [
  "Your own bot name and picture in your server",
  "Channels created for you, with the right permissions",
  "Live creator and sales data from your CRM",
  "Nothing posts until your team approves it",
];
const ORDER = ["name", "brand", "email", "password"];

/** Split sign-up / sign-in screen. App.jsx moves on to the app once a session exists. */
export default function Auth({ mode }) {
  const signup = mode === "signup";
  const copy = COPY[mode];
  const [values, setValues] = useState({ name: "", brand: "", email: "", password: "" });
  const [errors, setErrors] = useState({});
  // A failed Google sign-in comes back with its reason in the address.
  const [formError, setFormError] = useState(() => new URLSearchParams(location.search).get("auth_error") || "");
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (location.search.includes("auth_error")) history.replaceState(null, "", location.pathname + location.hash);
  }, []);

  const google = async () => {
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      await auth.google();
    } catch (e) {
      setFormError(e?.message || "Couldn’t start Google sign-in. Try again.");
      setBusy(false);
    }
  };

  const set = (field) => (e) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    if (errors[field]) setErrors((x) => ({ ...x, [field]: "" }));
    if (formError) setFormError("");
  };

  const focusFirst = (errs) => {
    const first = ORDER.find((f) => errs[f]);
    if (first) formRef.current?.elements[first]?.focus();
  };

  const run = async (action) => {
    setBusy(true);
    setFormError("");
    try {
      await action();
    } catch (e) {
      if (e?.field) {
        const errs = { [e.field]: e.message };
        setErrors(errs);
        focusFirst(errs);
      } else setFormError(e?.code === "offline" ? e.message : "Couldn’t sign you in. Try again.");
      setBusy(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = validate(mode, values);
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirst(errs);
    run(() => (signup ? auth.signUp(values) : auth.signIn(values)));
  };

  const field = (name, label, props) => (
    <label className="k-field">
      {label}
      <input
        className="k-input" name={name} value={values[name]} onChange={set(name)}
        aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? "err-" + name : undefined}
        {...props}
      />
      {errors[name] && <span className="k-err" id={"err-" + name} role="alert">{errors[name]}</span>}
    </label>
  );

  return (
    <div className="site k-auth">
      <div className="k-formside">
        <Logo />
        <div className="k-formbox">
          <h1>{copy.title}</h1>
          <p className="k-sub">{copy.sub}</p>
          <form className="k-form" onSubmit={onSubmit} ref={formRef} noValidate>
            {formError && <p className="k-formerr" role="alert">{formError}</p>}
            <button className="k-btn lg wide" type="button" disabled={busy} onClick={google}><GoogleMark />Continue with Google</button>
            <div className="k-or">or</div>
            {signup && field("name", "Full name", { placeholder: "Jordan Lee", autoComplete: "name", autoFocus: true })}
            {signup && field("brand", "Brand name", { placeholder: "Glow Lab", autoComplete: "organization" })}
            {field("email", signup ? "Work email" : "Email", { type: "email", placeholder: "jordan@glowlab.co", autoComplete: "email", autoFocus: !signup })}
            <label className="k-field">
              Password
              <span className="k-passwrap">
                <input
                  className="k-input" name="password" type={showPass ? "text" : "password"} value={values.password} onChange={set("password")}
                  placeholder={signup ? "At least 8 characters" : "Your password"} autoComplete={signup ? "new-password" : "current-password"}
                  aria-invalid={errors.password ? true : undefined} aria-describedby={errors.password ? "err-password" : undefined}
                />
                <button className="k-eye" type="button" onClick={() => setShowPass((s) => !s)} aria-label={showPass ? "Hide password" : "Show password"} aria-pressed={showPass}>
                  <Icon name={showPass ? "eyeOff" : "eye"} />
                </button>
              </span>
              {errors.password && <span className="k-err" id="err-password" role="alert">{errors.password}</span>}
            </label>
            <button className="k-btn primary lg wide" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? copy.busy : copy.submit}
            </button>
          </form>
          <p className="k-switch">
            {signup ? <>Already have an account? <a href="#signin">Sign in</a></> : <>New to {BRAND}? <a href="#signup">Create an account</a></>}
          </p>
        </div>
      </div>
      <aside className="k-art">
        <h2>Your community, set up before your coffee cools</h2>
        <ul>
          {POINTS.map((p) => <li key={p}><Icon name="check" /><span>{p}</span></li>)}
        </ul>
        <div className="k-dc" style={{ maxWidth: 420 }}>
          <BotMessage time="Today at 3:12 PM">
            <div><span className="k-mention">@mariah.makes</span> just hit her <b>10th sale</b>. Double digits! Keep going 🚀</div>
          </BotMessage>
        </div>
      </aside>
    </div>
  );
}
