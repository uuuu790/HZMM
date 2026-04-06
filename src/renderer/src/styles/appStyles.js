export const APP_STYLES = `
  ::selection { background: rgba(var(--accent-rgb), 0.3); }
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }
  ::view-transition-old(root) { z-index: 1; }
  ::view-transition-new(root) { z-index: 9999; }
  @keyframes slideUpFade {
    0% { opacity: 0; transform: translateY(20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideDownFade {
    0% { opacity: 0; transform: translateY(-20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes zoomInFade {
    0% { opacity: 0; transform: scale(0.96); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes toastSlideIn {
    0% { opacity: 0; transform: translateX(100%) scale(0.9); }
    100% { opacity: 1; transform: translateX(0) scale(1); }
  }
  @keyframes modalSpring {
    0% { opacity: 0; transform: scale(0.85) translateY(10px); }
    50% { transform: scale(1.02) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes orbFloat1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(3vw, -2vh) scale(1.05); }
    50% { transform: translate(-1vw, 3vh) scale(0.95); }
    75% { transform: translate(-3vw, -1vh) scale(1.03); }
  }
  @keyframes orbFloat2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(-4vw, 2vh) scale(1.04); }
    66% { transform: translate(2vw, -3vh) scale(0.97); }
  }
  @keyframes orbFloat3 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    20% { transform: translate(2vw, 3vh) scale(1.06); }
    60% { transform: translate(-3vw, -2vh) scale(0.96); }
    80% { transform: translate(1vw, 1vh) scale(1.02); }
  }
  @keyframes shimmerSweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes tabFadeIn {
    0% { opacity: 0; transform: translateY(8px) scale(0.995); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes tabSlideLeft {
    0% { opacity: 0; transform: translateX(30px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes tabSlideRight {
    0% { opacity: 0; transform: translateX(-30px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes logoBreath {
    0%, 100% { box-shadow: 0 0 15px rgba(249,115,22,0.3), 0 0 30px rgba(249,115,22,0.1); transform: scale(1); }
    50% { box-shadow: 0 0 25px rgba(249,115,22,0.5), 0 0 50px rgba(249,115,22,0.2); transform: scale(1.05); }
  }
  @keyframes toggleBounce {
    0% { transform: scale(1); }
    20% { transform: scale(1.25); }
    40% { transform: scale(0.92); }
    60% { transform: scale(1.08); }
    80% { transform: scale(0.98); }
    100% { transform: scale(1); }
  }
  @keyframes ripplePulse {
    0% { transform: scale(1); opacity: 0.4; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  @keyframes countPop {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
  @keyframes launchRocket {
    0% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-3px) rotate(-5deg); }
    50% { transform: translateY(-6px) rotate(0deg); }
    75% { transform: translateY(-3px) rotate(5deg); }
    100% { transform: translateY(0) rotate(0deg); }
  }
  @keyframes langItemIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes emptyBreath {
    0%, 100% { transform: scale(1); opacity: 0.4; }
    50% { transform: scale(1.08); opacity: 0.6; }
  }
  @keyframes newModPulse {
    0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.5); }
    70% { box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0); }
    100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0); }
  }
  @keyframes slideFromBottom {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes circularReveal {
    from { clip-path: circle(0% at var(--cx, 50%) var(--cy, 50%)); }
    to { clip-path: circle(150% at var(--cx, 50%) var(--cy, 50%)); }
  }
  .animate-slide-up { opacity: 0; animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-slide-down { opacity: 0; animation: slideDownFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-zoom-in { opacity: 0; animation: zoomInFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-toast-in { animation: toastSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .animate-modal-spring { animation: modalSpring 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .animate-tab-enter { animation: tabFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-tab-left { animation: tabSlideLeft 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-tab-right { animation: tabSlideRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .orb-float-1 { animation: orbFloat1 25s ease-in-out infinite; }
  .orb-float-2 { animation: orbFloat2 30s ease-in-out infinite; }
  .orb-float-3 { animation: orbFloat3 22s ease-in-out infinite; }
  .orb-float-4 { animation: orbFloat2 28s ease-in-out infinite reverse; }
  .shimmer-sweep::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
    animation: shimmerSweep 1.2s ease-in-out infinite;
  }
  .logo-breath { animation: logoBreath 3s ease-in-out infinite; }
  .toggle-bounce { animation: toggleBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .count-pop { animation: countPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .launch-hover:hover .launch-icon { animation: launchRocket 0.6s ease-in-out infinite; }
  .launch-hover:hover .launch-glow { animation: ripplePulse 1.5s ease-out infinite; }
  .glass-glow {
    transition: background 0.4s ease;
    background: transparent;
  }
  .glass-glow:hover {
    background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.06) 0%, transparent 60%);
  }
  .dark .glass-glow {
    background: transparent;
  }
  .dark .glass-glow:hover {
    background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.08) 0%, transparent 60%);
  }
`;
