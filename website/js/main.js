/* =========================================================================
 * SmartHair AI 官网 JS
 * 滚动动画 · 导航高亮 · 移动端菜单 · 表单处理
 * ========================================================================= */

// 滚动动画
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// 导航滚动效果
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 50);
  // 高亮当前 section
  const sections = document.querySelectorAll('section[id]');
  let current = '';
  sections.forEach(s => {
    if (window.scrollY >= s.offsetTop - 120) current = s.id;
  });
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.getAttribute('href') === '#' + current);
  });
});

// 移动端菜单
const toggle = document.getElementById('navToggle');
const links = document.getElementById('navLinks');
toggle.addEventListener('click', () => links.classList.toggle('open'));
document.querySelectorAll('.nav-link').forEach(l => {
  l.addEventListener('click', () => links.classList.remove('open'));
});

// 联系表单
document.getElementById('contactForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const btn = this.querySelector('button');
  const original = btn.textContent;
  btn.textContent = '已发送 ✓';
  btn.style.background = 'linear-gradient(135deg, #4ad4c8, #3ab8a8)';
  setTimeout(() => { btn.textContent = original; btn.style.background = ''; }, 2500);
  this.reset();
});

// 技术指标进度条动画
const techObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.querySelectorAll('.tech-fill').forEach(f => {
        f.style.width = f.style.width; // trigger reflow
      });
    }
  });
}, { threshold: 0.3 });
document.querySelectorAll('.tech-item').forEach(el => techObserver.observe(el));
