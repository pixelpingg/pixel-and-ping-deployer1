import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  ArrowUpRight, Check, ChevronDown, Eye, EyeOff, Globe2, KeyRound,
  Loader2, LockKeyhole, MousePointer2, Rocket, ShieldCheck,
  Terminal, TriangleAlert, X
} from "lucide-react";

type Lang = "en" | "fa" | "ru" | "zh";
type Account = { id: string; name: string; type?: string };
type Mode = "idle" | "accounts" | "deploying" | "ready" | "error";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const BASE_URL = import.meta.env.BASE_URL;
const LOGO_URL = `${BASE_URL}pixel-ping-logo.png`;
const DASHBOARD_IMAGE_URL = `${BASE_URL}pixel-ping-dashboard.png`;
const DASHBOARD_URL = "https://dash.cloudflare.com/";
const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_subdomain%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22user_details%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22memberships%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=PIXEL%20%26%20PING";

const copy = {
  en: {
    navDeploy: "Deploy", navPanel: "Panel",
    eyebrow: "CLOUDFLARE-NATIVE CONTROL PANEL",
    titleA: "Deploy your", titleB: "Pixel & Ping panel.",
    sub: "One token. One click. A real Cloudflare Worker panel, provisioned automatically in your own account.",
    token: "Cloudflare API token", placeholder: "Paste your API token",
    hint: "Used only for this deployment. Never saved to GitHub, D1, or the frontend.",
    deploy: "Deploy", dashboard: "Cloudflare Dashboard", getToken: "Create API token",
    account: "Choose your Cloudflare account", accountSub: "This token can access multiple accounts. Select where Pixel & Ping should be deployed.",
    continue: "Continue deployment", cancel: "Cancel",
    deploying: "Deploying Pixel & Ping…", ready: "Your panel is ready",
    open: "Open Panel", copy: "Copy password", copied: "Copied",
    username: "Username", password: "Initial password", url: "Panel URL",
    keep: "Save this password somewhere safe. It is shown only once.",
    error: "Deployment failed", retry: "Try again",
    live: "LIVE", mouse: "Move your mouse",
    secure: "Token stays private", real: "Real Cloudflare deployment", noReg: "No registration",
    steps: ["Validate token","Create D1","Run migrations","Create KV","Deploy Worker","Enable workers.dev","Create admin"]
  },
  fa: {
    navDeploy: "Deploy", navPanel: "پنل",
    eyebrow: "پنل CLOUDLFARE-NATIVE",
    titleA: "پنل", titleB: "Pixel & Ping را Deploy کن.",
    sub: "فقط یک توکن و یک کلیک؛ پنل واقعی Cloudflare مستقیماً داخل اکانت خودت ساخته و راه‌اندازی می‌شود.",
    token: "توکن API کلادفلر", placeholder: "توکن API را Paste کن",
    hint: "فقط برای همین Deploy استفاده می‌شود و در GitHub، D1 یا Frontend ذخیره نمی‌شود.",
    deploy: "Deploy", dashboard: "داشبورد Cloudflare", getToken: "ساخت API Token",
    account: "اکانت Cloudflare را انتخاب کن", accountSub: "این توکن به چند اکانت دسترسی دارد. اکانت مقصد Pixel & Ping را انتخاب کن.",
    continue: "ادامه Deploy", cancel: "لغو",
    deploying: "در حال Deploy کردن Pixel & Ping…", ready: "پنل آماده است",
    open: "باز کردن پنل", copy: "کپی رمز", copied: "کپی شد",
    username: "نام کاربری", password: "رمز اولیه", url: "آدرس پنل",
    keep: "این رمز را در جای امن ذخیره کن؛ فقط یک‌بار نمایش داده می‌شود.",
    error: "Deploy ناموفق بود", retry: "تلاش دوباره",
    live: "LIVE", mouse: "موس را حرکت بده",
    secure: "توکن خصوصی می‌ماند", real: "Deploy واقعی Cloudflare", noReg: "بدون ثبت‌نام",
    steps: ["بررسی توکن","ساخت D1","اجرای Migration","ساخت KV","Deploy Worker","فعال‌سازی workers.dev","ساخت Admin"]
  },
  ru: {
    navDeploy: "Deploy", navPanel: "Панель",
    eyebrow: "CLOUDFLARE-NATIVE ПАНЕЛЬ",
    titleA: "Разверните", titleB: "панель Pixel & Ping.",
    sub: "Один токен. Один клик. Настоящая панель Cloudflare Worker автоматически создаётся в вашем аккаунте.",
    token: "API-токен Cloudflare", placeholder: "Вставьте API-токен",
    hint: "Используется только для этого Deploy и не сохраняется в GitHub, D1 или frontend.",
    deploy: "Deploy", dashboard: "Cloudflare Dashboard", getToken: "Создать API-токен",
    account: "Выберите аккаунт Cloudflare", accountSub: "Токен имеет доступ к нескольким аккаунтам. Выберите аккаунт для Pixel & Ping.",
    continue: "Продолжить", cancel: "Отмена",
    deploying: "Разворачиваем Pixel & Ping…", ready: "Панель готова",
    open: "Открыть панель", copy: "Копировать пароль", copied: "Скопировано",
    username: "Имя пользователя", password: "Начальный пароль", url: "URL панели",
    keep: "Сохраните этот пароль в безопасном месте. Он показывается один раз.",
    error: "Развёртывание не удалось", retry: "Повторить",
    live: "LIVE", mouse: "Двигайте мышью",
    secure: "Токен остаётся приватным", real: "Настоящий Cloudflare Deploy", noReg: "Без регистрации",
    steps: ["Проверка токена","Создание D1","Миграции","Создание KV","Deploy Worker","workers.dev","Создание Admin"]
  },
  zh: {
    navDeploy: "Deploy", navPanel: "面板",
    eyebrow: "CLOUDFLARE-NATIVE 控制面板",
    titleA: "部署你的", titleB: "Pixel & Ping 面板。",
    sub: "一个 Token，一次点击。真正的 Cloudflare Worker 面板会自动部署到你的账号。",
    token: "Cloudflare API Token", placeholder: "粘贴 API Token",
    hint: "仅用于本次部署，不会保存到 GitHub、D1 或前端。",
    deploy: "Deploy", dashboard: "Cloudflare 控制台", getToken: "创建 API Token",
    account: "选择 Cloudflare 账号", accountSub: "此 Token 可访问多个账号，请选择 Pixel & Ping 的部署账号。",
    continue: "继续部署", cancel: "取消",
    deploying: "正在部署 Pixel & Ping…", ready: "面板已准备就绪",
    open: "打开面板", copy: "复制密码", copied: "已复制",
    username: "用户名", password: "初始密码", url: "面板地址",
    keep: "请安全保存此密码，它只显示一次。",
    error: "部署失败", retry: "重试",
    live: "LIVE", mouse: "移动鼠标",
    secure: "Token 保持私密", real: "真实 Cloudflare 部署", noReg: "无需注册",
    steps: ["验证 Token","创建 D1","执行迁移","创建 KV","部署 Worker","启用 workers.dev","创建 Admin"]
  }
} as const;

const stepIds = ["validate","d1","migrations","kv","script","enable_subdomain","admin"] as const;

async function requestApi(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem("pp-lang") as Lang | null;
    return saved && ["en","fa","ru","zh"].includes(saved) ? saved : "en";
  });
  const [languageOpen, setLanguageOpen] = useState(false);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{url:string;username:string;password:string}|null>(null);
  const [copied, setCopied] = useState(false);
  const [motion, setMotion] = useState({x:0,y:0,rx:0,ry:0});
  const visualRef = useRef<HTMLDivElement>(null);
  const t = copy[lang];
  const dir = lang === "fa" ? "rtl" : "ltr";

  useEffect(() => {
    localStorage.setItem("pp-lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const moveVisual = (event: MouseEvent<HTMLDivElement>) => {
    const rect = visualRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (event.clientX - rect.left) / rect.width - .5;
    const py = (event.clientY - rect.top) / rect.height - .5;
    setMotion({ x:px*20, y:py*15, rx:py*-5, ry:px*7 });
  };

  const resetVisual = () => setMotion({x:0,y:0,rx:0,ry:0});

  const reset = () => {
    setMode("idle"); setStep(-1); setError(""); setResult(null); setSelectedAccount("");
  };

  const deploy = async (accountId: string, rawToken = token.trim()) => {
    setMode("deploying"); setError(""); setStep(1);
    try {
      const started = await requestApi("/api/deploy", {
        method:"POST", body:JSON.stringify({token:rawToken,accountId})
      });
      const jobId = String(started.jobId);
      for (;;) {
        await new Promise(r => setTimeout(r, 900));
        const status = await requestApi(`/api/jobs/${encodeURIComponent(jobId)}`);
        const index = stepIds.findIndex(id => id === status.step);
        if (index >= 0) setStep(index + 1);
        if (status.status === "READY") {
          setStep(t.steps.length); setResult(status.result); setMode("ready"); return;
        }
        if (status.status === "FAILED") throw new Error(status.error || "Deployment failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deployment failed");
      setMode("error");
    }
  };

  const start = async () => {
    const clean = token.trim();
    if (!clean) return;
    setMode("deploying"); setStep(0); setError(""); setResult(null);
    try {
      const verified = await requestApi("/api/verify", {
        method:"POST", body:JSON.stringify({token:clean})
      });
      const found: Account[] = verified.accounts || [];
      if (!found.length) throw new Error("No accessible Cloudflare account was found for this token.");
      setAccounts(found);
      if (found.length > 1) {
        setMode("accounts"); setStep(-1); return;
      }
      await deploy(found[0].id, clean);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deployment failed");
      setMode("error");
    }
  };

  const copyPassword = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const languageName = lang === "fa" ? "فارسی" : lang === "ru" ? "Русский" : lang === "zh" ? "中文" : "English";

  return (
    <main className="orbit-page" id="top" dir={dir}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />

      <header className="orbit-nav">
        <a className="brand" href="#top">
          <span className="brand-symbol"><img src={LOGO_URL} alt="PIXEL & PING" /></span>
          <span>PIXEL &amp; PING</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#deploy">{t.navDeploy}</a>
          <a href="#panel">{t.navPanel}</a>
        </nav>
        <div className="language-wrap">
          <button className="language-btn" onClick={() => setLanguageOpen(v => !v)}>
            <Globe2 size={16}/><span>{languageName}</span><ChevronDown size={14}/>
          </button>
          {languageOpen && (
            <div className="language-menu">
              <button onClick={() => {setLang("en");setLanguageOpen(false)}}>🇬🇧 English</button>
              <button onClick={() => {setLang("fa");setLanguageOpen(false)}}>☀️ فارسی</button>
              <button onClick={() => {setLang("ru");setLanguageOpen(false)}}>🇷🇺 Русский</button>
              <button onClick={() => {setLang("zh");setLanguageOpen(false)}}>🇨🇳 中文</button>
            </div>
          )}
        </div>
      </header>

      <section className="orbit-hero" id="deploy">
        <div className="hero-copy">
          <div className="hero-eyebrow"><span className="pulse-dot"/>{t.eyebrow}</div>
          <h1>{t.titleA}<br/><span>{t.titleB}</span></h1>
          <p className="hero-sub">{t.sub}</p>

          <div className="deploy-panel">
            {mode === "idle" && (
              <>
                <div className="token-label"><KeyRound size={15}/><span>{t.token}</span></div>
                <div className="token-box">
                  <input
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && start()}
                    type={showToken ? "text" : "password"}
                    placeholder={t.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {token && <button className="icon-btn" onClick={() => setToken("")} aria-label="Clear"><X size={16}/></button>}
                  <button className="icon-btn" onClick={() => setShowToken(v => !v)} aria-label="Show token">
                    {showToken ? <EyeOff size={18}/> : <Eye size={18}/>}
                  </button>
                </div>
                <div className="token-hint"><LockKeyhole size={14}/>{t.hint}</div>
                <button className="primary-cta" disabled={!token.trim()} onClick={start}>
                  <Rocket size={17}/><span>{t.deploy}</span><ArrowUpRight size={17}/>
                </button>
              </>
            )}

            {mode === "accounts" && (
              <div className="account-picker">
                <div className="picker-heading"><ShieldCheck size={20}/><div><h2>{t.account}</h2><p>{t.accountSub}</p></div></div>
                <div className="account-list">
                  {accounts.map(a => (
                    <button key={a.id} className={`account-option ${selectedAccount === a.id ? "selected" : ""}`} onClick={() => setSelectedAccount(a.id)}>
                      <span className="account-cloud">☁</span>
                      <span className="account-name"><strong>{a.name}</strong><small>{a.id}</small></span>
                      <span className="radio-dot"/>
                    </button>
                  ))}
                </div>
                <div className="picker-actions">
                  <button className="secondary-cta" onClick={reset}><X size={15}/>{t.cancel}</button>
                  <button className="primary-cta" disabled={!selectedAccount} onClick={() => deploy(selectedAccount)}><Rocket size={17}/>{t.continue}</button>
                </div>
              </div>
            )}

            {mode === "deploying" && (
              <div className="progress-card">
                <div className="progress-head">
                  <span><Loader2 className="spin" size={15}/>{t.deploying}</span>
                  <strong>{Math.min(100, Math.round(Math.max(step,0) / t.steps.length * 100))}%</strong>
                </div>
                <div className="progress-track"><span style={{width:`${Math.min(100,Math.max(7,Math.max(step,0)/t.steps.length*100))}%`}}/></div>
                <div className="step-list">
                  {t.steps.map((label,i) => (
                    <div key={label} className={`deploy-step ${i < step ? "done" : ""} ${i === step ? "current" : ""}`}>
                      <span className="step-icon">{i < step ? <Check size={12}/> : i === step ? <Loader2 className="spin" size={12}/> : null}</span>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mode === "ready" && result && (
              <div className="result-card">
                <div className="success-badge"><Check size={22}/></div>
                <h2>{t.ready}</h2>
                <div className="result-field"><span>{t.url}</span><a href={result.url} target="_blank" rel="noreferrer">{result.url}<ArrowUpRight size={14}/></a></div>
                <div className="result-row">
                  <div><span>{t.username}</span><code>{result.username}</code></div>
                  <div><span>{t.password}</span><div className="password-line"><code>{result.password}</code><button onClick={copyPassword}>{copied?<Check size={14}/>:<KeyRound size={14}/>} {copied?t.copied:t.copy}</button></div></div>
                </div>
                <p className="save-note"><LockKeyhole size={14}/>{t.keep}</p>
                <a className="primary-cta result-open" href={result.url} target="_blank" rel="noreferrer"><ArrowUpRight size={17}/>{t.open}</a>
              </div>
            )}

            {mode === "error" && (
              <div className="error-card">
                <div className="error-icon"><TriangleAlert size={23}/></div>
                <div><h2>{t.error}</h2><p>{error}</p></div>
                <button className="primary-cta" onClick={reset}><Rocket size={17}/>{t.retry}</button>
              </div>
            )}
          </div>

          {mode === "idle" && (
            <div className="under-card">
              <div className="quick-links">
                <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">{t.dashboard}<ArrowUpRight size={13}/></a>
                <a href={TOKEN_URL} target="_blank" rel="noreferrer">{t.getToken}<ArrowUpRight size={13}/></a>
              </div>
              <div className="trust-row">
                <span><ShieldCheck size={14}/>{t.secure}</span>
                <span><Rocket size={14}/>{t.real}</span>
                <span><LockKeyhole size={14}/>{t.noReg}</span>
              </div>
            </div>
          )}
        </div>

        <div className="hero-visual" id="panel" ref={visualRef} onMouseMove={moveVisual} onMouseLeave={resetVisual}>
          <div className="dot-field"/>
          <div className="visual-glow glow-left"/>
          <div className="visual-glow glow-right"/>

          <div className="dashboard-label"><span className="live-dot"/>{t.live}<strong>PIXEL &amp; PING</strong></div>

          <div className="dashboard-wrap" style={{transform:`translate3d(${motion.x}px,${motion.y}px,0) rotateX(${motion.rx}deg) rotateY(${motion.ry}deg)`}}>
            <div className="dashboard-frame">
              <div className="browser-bar"><span className="window-dots"><i/><i/><i/></span><span className="browser-title">pixel &amp; ping</span><span className="browser-status">LIVE</span></div>
              <div className="dashboard-image"><img src={DASHBOARD_IMAGE_URL} alt="Pixel & Ping dashboard"/></div>
            </div>
          </div>

          <div className="floating-card cloudflare-card"><span className="float-icon">☁</span><span><b>Cloudflare</b><small>Connected</small></span><Check size={15}/></div>
          <div className="floating-card worker-card"><Terminal size={16}/><span><b>Worker</b><small>Ready to deploy</small></span></div>
          <div className="mouse-hint"><MousePointer2 size={14}/>{t.mouse}</div>
        </div>
      </section>

      <section className="feature-strip">
        <div><span>01</span><b>One-click provisioning</b><small>D1 · KV · Worker · workers.dev</small></div>
        <div><span>02</span><b>Real admin credentials</b><small>Secure random initial password</small></div>
        <div><span>03</span><b>Health checked</b><small>Panel URL only after a real health check</small></div>
      </section>

      <footer className="orbit-footer"><span>© {new Date().getFullYear()} PIXEL &amp; PING</span><span>Cloudflare-native control panel</span></footer>
    </main>
  );
}
