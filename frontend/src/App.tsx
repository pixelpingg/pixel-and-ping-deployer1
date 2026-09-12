import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ArrowUpRight, Check, ChevronDown, Eye, EyeOff, Globe2, KeyRound, Loader2, LockKeyhole, MousePointer2, Rocket, ShieldCheck, Terminal, TriangleAlert, X } from "lucide-react";

type Lang = "en" | "fa" | "ru" | "zh";
type Account = { id: string; name: string; type?: string };
type Mode = "idle" | "accounts" | "deploying" | "ready" | "error";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const DASHBOARD_URL = "https://dash.cloudflare.com/";
const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_subdomain%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22user_details%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22memberships%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=PIXEL%20%26%20PING";

const text: Record<Lang, Record<string, string>> = {
  en: { eyebrow:"CLOUDFLARE PANEL DEPLOYMENT", titleA:"Deploy your", titleB:"Pixel & Ping panel.", sub:"One token. One click. A real Cloudflare Worker panel, provisioned automatically in your own account.", token:"Paste your Cloudflare API token", hint:"Your token is used only for this deployment and is never written to the frontend or GitHub.", deploy:"Deploy", dashboard:"Open Cloudflare Dashboard", getToken:"Get Cloudflare Token", noAccount:"Don't have a Cloudflare account?", secure:"Secure by design", private:"No registration", real:"Real deployment", four:"4 languages", choose:"Choose Cloudflare account", chooseSub:"Your token can access more than one account. Select where Pixel & Ping should be deployed.", continue:"Continue deployment", cancel:"Cancel", validating:"Validating token…", deployment:"Deploying Pixel & Ping…", ready:"Deployment complete", open:"Open Panel", copy:"Copy password", copied:"Copied", username:"Username", password:"Initial password", url:"Panel URL", keep:"Save this password somewhere safe. It is shown once.", errorTitle:"Deployment failed", retry:"Try again", mouse:"Move your mouse", live:"LIVE" },
  fa: { eyebrow:"استقرار پنل روی CLOUDFLARE", titleA:"پنل", titleB:"Pixel & Ping را Deploy کن.", sub:"فقط یک توکن و یک کلیک؛ پنل واقعی Cloudflare داخل اکانت خودت به‌صورت خودکار ساخته و راه‌اندازی می‌شود.", token:"توکن Cloudflare را اینجا Paste کن", hint:"توکن فقط برای همین Deploy استفاده می‌شود و داخل Frontend یا GitHub ذخیره نمی‌شود.", deploy:"Deploy", dashboard:"ورود به داشبورد Cloudflare", getToken:"دریافت توکن Cloudflare", noAccount:"اکانت Cloudflare نداری؟", secure:"امن و اصولی", private:"بدون ثبت‌نام", real:"Deploy واقعی", four:"۴ زبان", choose:"انتخاب اکانت Cloudflare", chooseSub:"این توکن به بیش از یک اکانت دسترسی دارد. اکانتی که پنل باید در آن ساخته شود را انتخاب کن.", continue:"ادامه Deploy", cancel:"لغو", validating:"در حال بررسی توکن…", deployment:"در حال Deploy کردن Pixel & Ping…", ready:"Deploy با موفقیت انجام شد", open:"باز کردن پنل", copy:"کپی رمز", copied:"کپی شد", username:"نام کاربری", password:"رمز اولیه", url:"آدرس پنل", keep:"این رمز را در جای امن ذخیره کن؛ فقط یک‌بار نمایش داده می‌شود.", errorTitle:"Deploy ناموفق بود", retry:"تلاش دوباره", mouse:"موس را حرکت بده", live:"زنده" },
  ru: { eyebrow:"РАЗВЕРТЫВАНИЕ CLOUDFLARE-ПАНЕЛИ", titleA:"Разверните свою", titleB:"панель Pixel & Ping.", sub:"Один токен. Один клик. Настоящая панель Cloudflare автоматически создаётся в вашем аккаунте.", token:"Вставьте API-токен Cloudflare", hint:"Токен используется только для этого развёртывания и не сохраняется во frontend или GitHub.", deploy:"Deploy", dashboard:"Открыть Cloudflare Dashboard", getToken:"Получить токен Cloudflare", noAccount:"Нет аккаунта Cloudflare?", secure:"Безопасно", private:"Без регистрации", real:"Настоящий Deploy", four:"4 языка", choose:"Выберите аккаунт Cloudflare", chooseSub:"Токен имеет доступ к нескольким аккаунтам. Выберите аккаунт для Pixel & Ping.", continue:"Продолжить", cancel:"Отмена", validating:"Проверяем токен…", deployment:"Разворачиваем Pixel & Ping…", ready:"Развёртывание завершено", open:"Открыть панель", copy:"Копировать пароль", copied:"Скопировано", username:"Имя пользователя", password:"Начальный пароль", url:"URL панели", keep:"Сохраните этот пароль в безопасном месте. Он показывается один раз.", errorTitle:"Развёртывание не удалось", retry:"Повторить", mouse:"Двигайте мышью", live:"LIVE" },
  zh: { eyebrow:"CLOUDFLARE 面板部署", titleA:"部署你的", titleB:"Pixel & Ping 面板。", sub:"一个 Token，一次点击。真正的 Cloudflare Worker 面板将自动部署到你的账号。", token:"粘贴 Cloudflare API Token", hint:"Token 仅用于本次部署，不会写入前端或 GitHub。", deploy:"Deploy", dashboard:"打开 Cloudflare 控制台", getToken:"获取 Cloudflare Token", noAccount:"还没有 Cloudflare 账号？", secure:"安全设计", private:"无需注册", real:"真实部署", four:"4 种语言", choose:"选择 Cloudflare 账号", chooseSub:"此 Token 可访问多个账号，请选择 Pixel & Ping 的部署账号。", continue:"继续部署", cancel:"取消", validating:"正在验证 Token…", deployment:"正在部署 Pixel & Ping…", ready:"部署完成", open:"打开面板", copy:"复制密码", copied:"已复制", username:"用户名", password:"初始密码", url:"面板地址", keep:"请安全保存此密码，它只显示一次。", errorTitle:"部署失败", retry:"重试", mouse:"移动鼠标", live:"LIVE" },
};

const stepDefs = [
  ["validate", {en:"Validate token",fa:"بررسی توکن",ru:"Проверка токена",zh:"验证 Token"}],
  ["d1", {en:"Create D1",fa:"ساخت D1",ru:"Создание D1",zh:"创建 D1"}],
  ["migrations", {en:"Run migrations",fa:"اجرای Migration",ru:"Миграции",zh:"执行迁移"}],
  ["kv", {en:"Create KV",fa:"ساخت KV",ru:"Создание KV",zh:"创建 KV"}],
  ["script", {en:"Deploy Worker",fa:"Deploy Worker",ru:"Deploy Worker",zh:"部署 Worker"}],
  ["enable_subdomain", {en:"Enable workers.dev",fa:"فعال‌سازی workers.dev",ru:"Включение workers.dev",zh:"启用 workers.dev"}],
  ["admin", {en:"Create admin",fa:"ساخت Admin",ru:"Создание Admin",zh:"创建 Admin"}],
] as const;

async function requestApi(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("pp-lang") as Lang) || "en");
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
  const t = text[lang];
  const dir = lang === "fa" ? "rtl" : "ltr";

  useEffect(() => { localStorage.setItem("pp-lang", lang); document.documentElement.lang = lang; document.documentElement.dir = dir; }, [lang, dir]);

  const moveVisual = (event: MouseEvent<HTMLDivElement>) => {
    const rect = visualRef.current?.getBoundingClientRect(); if (!rect) return;
    const px = (event.clientX - rect.left) / rect.width - .5;
    const py = (event.clientY - rect.top) / rect.height - .5;
    setMotion({x:px*18,y:py*14,rx:py*-5,ry:px*7});
  };
  const resetVisual = () => setMotion({x:0,y:0,rx:0,ry:0});

  const reset = () => { setMode("idle"); setStep(-1); setError(""); setResult(null); setSelectedAccount(""); };

  const start = async () => {
    const clean = token.trim(); if (!clean) return;
    setMode("deploying"); setStep(0); setError(""); setResult(null);
    try {
      const verified = await requestApi("/api/verify", {method:"POST",body:JSON.stringify({token:clean})});
      const found: Account[] = verified.accounts || [];
      if (!found.length) throw new Error("No accessible Cloudflare account was found for this token.");
      setAccounts(found);
      if (found.length > 1) { setMode("accounts"); setStep(-1); return; }
      await deploy(found[0].id, clean);
    } catch (e) { setError(e instanceof Error ? e.message : "Deployment failed"); setMode("error"); }
  };

  const deploy = async (accountId: string, rawToken = token.trim()) => {
    setMode("deploying"); setError(""); setStep(1);
    try {
      const started = await requestApi("/api/deploy", {method:"POST",body:JSON.stringify({token:rawToken,accountId})});
      const jobId = String(started.jobId);
      for (;;) {
        await new Promise((r) => setTimeout(r, 850));
        const status = await requestApi(`/api/jobs/${encodeURIComponent(jobId)}`);
        const index = stepDefs.findIndex(([id]) => id === status.step);
        if (index >= 0) setStep(index + 1);
        if (status.status === "READY") { setStep(stepDefs.length); setResult(status.result); setMode("ready"); return; }
        if (status.status === "FAILED") throw new Error(status.error || "Deployment failed");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Deployment failed"); setMode("error"); }
  };

  const copyPassword = async () => { if (!result) return; await navigator.clipboard.writeText(result.password); setCopied(true); setTimeout(()=>setCopied(false),1500); };

  return <main className="landing" dir={dir} id="top">
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark"><img src="/pixel-ping-logo.png" alt="" /></span><span>PIXEL &amp; PING</span></a>
      <div className="language-wrap">
        <button className="language-btn" onClick={()=>setLanguageOpen(v=>!v)}><Globe2 size={16}/><span>{lang === "fa" ? "فارسی" : lang === "ru" ? "Русский" : lang === "zh" ? "中文" : "English"}</span><ChevronDown size={14}/></button>
        {languageOpen && <div className="language-menu"><button onClick={()=>{setLang("en");setLanguageOpen(false)}}>🇬🇧 English</button><button onClick={()=>{setLang("fa");setLanguageOpen(false)}}>🇮🇷 فارسی</button><button onClick={()=>{setLang("ru");setLanguageOpen(false)}}>🇷🇺 Русский</button><button onClick={()=>{setLang("zh");setLanguageOpen(false)}}>🇨🇳 中文</button></div>}
      </div>
    </header>

    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot"/>{t.eyebrow}</div>
        <h1>{t.titleA}<br/><span>{t.titleB}</span></h1>
        <p className="hero-sub">{t.sub}</p>

        <div className="deploy-card">
          {mode === "accounts" && <div className="account-picker">
            <div className="picker-icon"><ShieldCheck size={21}/></div><h2>{t.choose}</h2><p>{t.chooseSub}</p>
            <div className="account-list">{accounts.map(a=><button key={a.id} className={`account-option ${selectedAccount===a.id?"selected":""}`} onClick={()=>setSelectedAccount(a.id)}><span className="account-avatar">☁</span><span><strong>{a.name}</strong><small>{a.id}</small></span><span className="radio-dot"/></button>)}</div>
            <div className="picker-actions"><button className="secondary-btn" onClick={reset}><X size={15}/>{t.cancel}</button><button className="deploy-btn" disabled={!selectedAccount} onClick={()=>deploy(selectedAccount)}><Rocket size={17}/>{t.continue}</button></div>
          </div>}

          {mode === "deploying" && <div className="progress-card"><div className="progress-top"><div><span className="status-kicker"><Loader2 className="spin" size={15}/>{t.deployment}</span><strong>{Math.min(100,Math.round(Math.max(step,0)/stepDefs.length*100))}%</strong></div><div className="progress-track"><span style={{width:`${Math.min(100,Math.max(6,Math.max(step,0)/stepDefs.length*100))}%`}}/></div></div><div className="step-list">{stepDefs.map(([id,labels],i)=><div key={id} className={`step ${i<step?"done":""} ${i===step?"current":""}`}><span className="step-icon">{i<step?<Check size={12}/>:i===step?<Loader2 className="spin" size={12}/>:<span/>}</span><span>{labels[lang]}</span></div>)}</div></div>}

          {mode === "ready" && result && <div className="result-card"><div className="success-orb"><Check size={28}/></div><div className="result-title">{t.ready}</div><div className="result-grid"><div><span>{t.url}</span><a href={result.url} target="_blank" rel="noreferrer">{result.url}<ArrowUpRight size={14}/></a></div><div><span>{t.username}</span><code>{result.username}</code></div><div><span>{t.password}</span><div className="password-row"><code>{result.password}</code><button onClick={copyPassword}>{copied?<Check size={14}/>:<KeyRound size={14}/>} {copied?t.copied:t.copy}</button></div></div></div><p className="save-note"><LockKeyhole size={14}/>{t.keep}</p><a className="deploy-btn result-open" href={result.url} target="_blank" rel="noreferrer"><ArrowUpRight size={17}/>{t.open}</a></div>}

          {mode === "error" && <div className="error-card"><div className="error-orb"><TriangleAlert size={24}/></div><div><h2>{t.errorTitle}</h2><p>{error}</p></div><button className="deploy-btn" onClick={reset}><Rocket size={17}/>{t.retry}</button></div>}

          {mode === "idle" && <><div className="token-label"><KeyRound size={15}/>{t.token}</div><div className="token-row"><input value={token} onChange={e=>setToken(e.target.value)} onKeyDown={e=>e.key==="Enter"&&start()} type={showToken?"text":"password"} placeholder={t.token} autoComplete="off" spellCheck={false}/>{token&&<button className="clear-token" onClick={()=>setToken("")}><X size={15}/></button>}<button className="eye-btn" onClick={()=>setShowToken(v=>!v)}>{showToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><p className="token-hint"><LockKeyhole size={14}/>{t.hint}</p><button className="deploy-btn" disabled={!token.trim()} onClick={start}><Rocket size={18}/>{t.deploy}<ArrowUpRight size={17}/></button></>}
        </div>

        {mode === "idle" && <><div className="cloudflare-links"><span>{t.noAccount}</span><a href={DASHBOARD_URL} target="_blank" rel="noreferrer"><span>{t.dashboard}</span><ArrowUpRight size={13}/></a><a href={TOKEN_URL} target="_blank" rel="noreferrer"><span>{t.getToken}</span><ArrowUpRight size={13}/></a></div><div className="trust-row"><span><ShieldCheck size={14}/>{t.secure}</span><span><LockKeyhole size={14}/>{t.private}</span><span><Rocket size={14}/>{t.real}</span><span><Globe2 size={14}/>{t.four}</span></div></>}
      </div>

      <div className="hero-visual" ref={visualRef} onMouseMove={moveVisual} onMouseLeave={resetVisual}>
        <div className="visual-grid"/><div className="glow glow-a"/><div className="glow glow-b"/>
        <div className="visual-copy"><span><span className="live-dot"/>{t.live}</span><strong>PIXEL &amp; PING</strong><small>Cloudflare-native control panel</small></div>
        <div className="mockup-shell" style={{transform:`translate3d(${motion.x}px,${motion.y}px,0) rotateX(${motion.rx}deg) rotateY(${motion.ry}deg)`}}><div className="mockup-top"><span className="window-dots"><i/><i/><i/></span><span>pixel-and-ping</span><span className="mockup-pill">v1.1.1</span></div><img src="/pixel-ping-dashboard.png" alt="Pixel & Ping dashboard"/><div className="mockup-reflection"/></div>
        <div className="floating-card fc-one"><span className="cf-icon">☁</span><span><b>Cloudflare</b><small>Connected</small></span><Check size={15}/></div><div className="floating-card fc-two"><Terminal size={16}/><span><b>Worker</b><small>Ready to deploy</small></span></div><div className="mouse-hint"><MousePointer2 size={14}/>{t.mouse}</div>
      </div>
    </section>
    <footer className="footer"><span>© {new Date().getFullYear()} PIXEL &amp; PING</span><span>Cloudflare-native · No registration</span></footer>
  </main>;
}
