<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'

import { login, register, resetPassword, sendVerificationCode } from '../services/auth'

type AuthMode = 'login' | 'register' | 'reset'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const mode = ref<AuthMode>('login')
const isSubmitting = ref(false)
const isSendingCode = ref(false)
const isPasswordVisible = ref(false)
const countdown = ref(0)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const form = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  verificationCode: '',
})

let timer: number | undefined

const isLogin = computed(() => mode.value === 'login')
const isRegister = computed(() => mode.value === 'register')
const isReset = computed(() => mode.value === 'reset')
const needsCode = computed(() => isRegister.value || isReset.value)
const pageTitle = computed(() => {
  if (isRegister.value) return '注册账号'
  if (isReset.value) return '找回密码'
  return '登录平台'
})
const submitText = computed(() => {
  if (isSubmitting.value) return '提交中'
  if (isRegister.value) return '创建账号'
  if (isReset.value) return '重置密码'
  return '登录'
})
const codeScene = computed(() => (isReset.value ? 'reset-password' : 'register'))
const canSendCode = computed(
  () =>
    needsCode.value &&
    EMAIL_PATTERN.test(form.email) &&
    countdown.value === 0 &&
    !isSendingCode.value,
)

function setMode(nextMode: AuthMode) {
  mode.value = nextMode
  message.value = ''
}

function setMessage(type: 'success' | 'error', text: string) {
  messageType.value = type
  message.value = text
}

function validateEmail() {
  if (isLogin.value) {
    if (!form.email.trim()) {
      setMessage('error', '请输入用户名或邮箱')
      return false
    }

    return true
  }

  if (!EMAIL_PATTERN.test(form.email)) {
    setMessage('error', '请输入正确的邮箱地址')
    return false
  }

  return true
}

function validateUsername() {
  if (!isRegister.value) return true

  const username = form.username.trim()
  if (username.length < 3 || username.length > 50) {
    setMessage('error', '用户名长度应为 3-50 位')
    return false
  }

  return true
}

function validatePassword() {
  if (isLogin.value) {
    if (!form.password.trim()) {
      setMessage('error', '请输入密码')
      return false
    }

    return true
  }

  if (form.password.trim().length < 6) {
    setMessage('error', '密码至少需要 6 位')
    return false
  }

  if (form.password !== form.confirmPassword) {
    setMessage('error', '两次输入的密码不一致')
    return false
  }

  return true
}

function validateCode() {
  if (needsCode.value && form.verificationCode.trim().length !== 6) {
    setMessage('error', '请输入 6 位邮箱验证码')
    return false
  }

  return true
}

function startCountdown() {
  if (timer) window.clearInterval(timer)

  countdown.value = 60
  timer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && timer) {
      window.clearInterval(timer)
      timer = undefined
    }
  }, 1000)
}

async function handleSendCode() {
  if (!validateEmail()) return

  try {
    isSendingCode.value = true
    const result = await sendVerificationCode(form.email, codeScene.value)
    setMessage(result.success ? 'success' : 'error', result.message || '验证码已发送')
    startCountdown()
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '验证码发送失败')
  } finally {
    isSendingCode.value = false
  }
}

async function handleSubmit() {
  if (!validateEmail() || !validateUsername() || !validatePassword() || !validateCode()) return

  try {
    isSubmitting.value = true
    const result = isRegister.value
      ? await register({
          username: form.username,
          email: form.email,
          password: form.password,
          code: form.verificationCode,
        })
      : isReset.value
        ? await resetPassword({
            email: form.email,
            newPassword: form.password,
            code: form.verificationCode,
          })
        : await login({
            account: form.email,
            password: form.password,
          })

    setMessage(result.success ? 'success' : 'error', result.message || '操作成功')
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '请求失败，请稍后再试')
  } finally {
    isSubmitting.value = false
  }
}

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <main class="research-login">
    <div class="water-texture" aria-hidden="true"></div>
    <div class="network-grid" aria-hidden="true"></div>
    <div class="molecule molecule-one" aria-hidden="true">
      <i></i>
      <i></i>
      <i></i>
      <span></span>
      <span></span>
    </div>
    <div class="molecule molecule-two" aria-hidden="true">
      <i></i>
      <i></i>
      <i></i>
      <span></span>
      <span></span>
    </div>
    <div class="particles" aria-hidden="true">
      <i></i>
      <i></i>
      <i></i>
      <i></i>
      <i></i>
      <i></i>
    </div>

    <section class="auth-card" aria-label="账号认证">
      <header class="auth-header">
        <div class="brand-mark">WBE</div>
        <h1>污水信息物质信息库</h1>
        <p>基于污水监测的数据可视化与公共健康研究平台</p>
      </header>

      <form class="auth-form" @submit.prevent="handleSubmit">
        <label>
          <span>用户名 / 邮箱</span>
          <input
            v-model.trim="form.email"
            :type="isLogin ? 'text' : 'email'"
            autocomplete="email"
            :placeholder="isLogin ? '用户名或 name@example.com' : 'name@example.com'"
          />
        </label>

        <label v-if="isRegister">
          <span>用户名</span>
          <input
            v-model.trim="form.username"
            type="text"
            autocomplete="username"
            placeholder="3-50 位用户名"
          />
        </label>

        <label>
          <span>{{ isReset ? '新密码' : '密码' }}</span>
          <div class="password-row">
            <input
              v-model.trim="form.password"
              :type="isPasswordVisible ? 'text' : 'password'"
              :autocomplete="isLogin ? 'current-password' : 'new-password'"
              placeholder="至少 6 位"
            />
            <button
              type="button"
              class="icon-button"
              :aria-label="isPasswordVisible ? '隐藏密码' : '显示密码'"
              @click="isPasswordVisible = !isPasswordVisible"
            >
              {{ isPasswordVisible ? '隐藏' : '显示' }}
            </button>
          </div>
        </label>

        <label v-if="!isLogin">
          <span>确认密码</span>
          <input
            v-model.trim="form.confirmPassword"
            :type="isPasswordVisible ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="再次输入密码"
          />
        </label>

        <label v-if="needsCode">
          <span>邮箱验证码</span>
          <div class="code-row">
            <input
              v-model.trim="form.verificationCode"
              type="text"
              inputmode="numeric"
              maxlength="6"
              placeholder="6 位验证码"
            />
            <button
              type="button"
              class="code-button"
              :disabled="!canSendCode"
              @click="handleSendCode"
            >
              {{ countdown > 0 ? `${countdown}s` : isSendingCode ? '发送中' : '发送验证码' }}
            </button>
          </div>
        </label>

        <p v-if="message" class="form-message" :class="messageType">{{ message }}</p>

        <button type="submit" class="primary-button" :disabled="isSubmitting">
          {{ submitText }}
        </button>

        <div class="action-links">
          <button v-if="!isReset" type="button" @click="setMode('reset')">忘记密码</button>
          <button v-if="!isRegister" type="button" @click="setMode('register')">注册账号</button>
          <button v-if="!isLogin" type="button" @click="setMode('login')">返回登录</button>
        </div>
      </form>

      <div class="mode-label">{{ pageTitle }}</div>
    </section>

    <section class="visual-panel" aria-label="学术数据可视化">
      <div class="panel-header">
        <span>Research Monitor</span>
        <strong>水环境数据概览</strong>
      </div>

      <div class="wave-chart" aria-hidden="true">
        <svg viewBox="0 0 360 170" role="img">
          <defs>
            <linearGradient id="waveGradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="#4A9FFF" />
              <stop offset="100%" stop-color="#00C8B8" />
            </linearGradient>
          </defs>
          <path
            d="M12 114 C48 84 78 88 111 105 C145 123 169 122 201 86 C235 47 266 49 301 79 C323 98 338 104 350 95"
            fill="none"
            stroke="url(#waveGradient)"
            stroke-width="5"
            stroke-linecap="round"
          />
          <path
            d="M12 128 C54 112 82 118 116 132 C156 149 186 142 214 116 C249 84 282 90 315 116 C331 128 342 132 350 127"
            fill="none"
            stroke="#b7dcff"
            stroke-width="3"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div class="metric-grid">
        <div>
          <span>样本完整率</span>
          <strong>98.6%</strong>
        </div>
        <div>
          <span>监测点位</span>
          <strong>42</strong>
        </div>
        <div>
          <span>物质条目</span>
          <strong>1,286</strong>
        </div>
      </div>
    </section>

    <footer class="page-footer">v1.0.0 © 2026 WBE Information Platform</footer>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  min-width: 320px;
  color: #173247;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
  background: #f0f7ff;
}

button,
input {
  font: inherit;
}

.research-login {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(360px, 0.88fr) minmax(420px, 1.12fr);
  align-items: center;
  gap: clamp(32px, 7vw, 92px);
  padding: clamp(26px, 5vw, 76px);
  isolation: isolate;
  background:
    radial-gradient(circle at 78% 18%, rgba(74, 159, 255, 0.22), transparent 30%),
    radial-gradient(circle at 18% 82%, rgba(0, 200, 184, 0.16), transparent 26%),
    linear-gradient(135deg, #f0f7ff 0%, #ffffff 46%, #e0f0ff 100%);
}

.research-login::before,
.research-login::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.research-login::before {
  opacity: 0.42;
  background:
    repeating-radial-gradient(
      ellipse at 24% 24%,
      transparent 0 28px,
      rgba(74, 159, 255, 0.12) 29px 30px,
      transparent 31px 60px
    ),
    repeating-radial-gradient(
      ellipse at 76% 78%,
      transparent 0 34px,
      rgba(0, 200, 184, 0.1) 35px 36px,
      transparent 37px 70px
    );
}

.research-login::after {
  opacity: 0.38;
  background-image:
    linear-gradient(rgba(74, 159, 255, 0.1) 1px, transparent 1px),
    linear-gradient(90deg, rgba(74, 159, 255, 0.1) 1px, transparent 1px);
  background-size: 74px 74px;
  mask-image: linear-gradient(90deg, #000, #000 70%, transparent);
}

.water-texture,
.network-grid,
.molecule,
.particles {
  position: absolute;
  pointer-events: none;
  z-index: -1;
}

.water-texture {
  inset: 0;
  background: linear-gradient(
    110deg,
    transparent 0 12%,
    rgba(255, 255, 255, 0.58) 12.2%,
    transparent 12.8% 44%,
    rgba(74, 159, 255, 0.08) 44.2%,
    transparent 44.8%
  );
  animation: textureShift 12s ease-in-out infinite alternate;
}

.network-grid {
  right: -8%;
  bottom: -4%;
  width: min(780px, 62vw);
  height: 42vh;
  opacity: 0.28;
  transform: perspective(900px) rotateX(56deg) rotateZ(-10deg);
  background-image:
    linear-gradient(rgba(0, 200, 184, 0.24) 1px, transparent 1px),
    linear-gradient(90deg, rgba(74, 159, 255, 0.28) 1px, transparent 1px);
  background-size: 48px 48px;
}

.molecule {
  width: 160px;
  height: 112px;
  opacity: 0.26;
}

.molecule-one {
  top: 11%;
  right: 17%;
}

.molecule-two {
  left: 8%;
  bottom: 10%;
  transform: scale(0.82) rotate(-16deg);
}

.molecule i,
.molecule span {
  position: absolute;
  display: block;
}

.molecule i {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 200, 184, 0.6);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.72);
}

.molecule i:nth-child(1) {
  left: 18px;
  top: 46px;
}

.molecule i:nth-child(2) {
  left: 80px;
  top: 16px;
}

.molecule i:nth-child(3) {
  right: 20px;
  bottom: 18px;
}

.molecule span {
  height: 2px;
  width: 72px;
  background: rgba(74, 159, 255, 0.45);
  transform-origin: left center;
}

.molecule span:nth-of-type(1) {
  left: 31px;
  top: 52px;
  transform: rotate(-26deg);
}

.molecule span:nth-of-type(2) {
  left: 91px;
  top: 27px;
  transform: rotate(38deg);
}

.particles {
  inset: 0;
}

.particles i {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(74, 159, 255, 0.26);
  box-shadow: 0 0 18px rgba(74, 159, 255, 0.26);
  animation: particleFloat 8s ease-in-out infinite;
}

.particles i:nth-child(1) {
  left: 12%;
  top: 18%;
}

.particles i:nth-child(2) {
  left: 30%;
  bottom: 16%;
  animation-delay: -1.4s;
}

.particles i:nth-child(3) {
  right: 23%;
  top: 20%;
  animation-delay: -2.8s;
}

.particles i:nth-child(4) {
  right: 12%;
  top: 56%;
  animation-delay: -4.2s;
}

.particles i:nth-child(5) {
  left: 54%;
  bottom: 16%;
  animation-delay: -5.4s;
}

.particles i:nth-child(6) {
  left: 42%;
  top: 42%;
  animation-delay: -6.1s;
}

.auth-card,
.visual-panel {
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.84);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow:
    0 28px 80px rgba(68, 116, 164, 0.18),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
  backdrop-filter: blur(20px);
}

.auth-card {
  width: min(460px, 100%);
  padding: clamp(26px, 4vw, 40px);
}

.auth-header {
  text-align: center;
}

.brand-mark {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
  border-radius: 16px;
  color: #ffffff;
  background: linear-gradient(135deg, #4a9fff, #00c8b8);
  box-shadow: 0 18px 34px rgba(0, 152, 196, 0.22);
  font-weight: 900;
}

.auth-header h1 {
  margin: 0;
  color: #11334a;
  font-size: clamp(27px, 3vw, 34px);
  line-height: 1.18;
  letter-spacing: 0;
}

.auth-header h1::after {
  content: '';
  display: block;
  width: 42px;
  height: 3px;
  margin: 14px auto 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #4a9fff, #00c8b8);
}

.auth-header p {
  margin: 14px 0 0;
  color: #547187;
  font-size: 14px;
  line-height: 1.7;
}

.auth-form {
  display: grid;
  gap: 16px;
  margin-top: 30px;
}

.auth-form label {
  display: grid;
  gap: 8px;
  color: #294b63;
  font-size: 14px;
  font-weight: 700;
}

.auth-form input {
  width: 100%;
  height: 48px;
  border: 1px solid rgba(117, 158, 194, 0.32);
  border-radius: 12px;
  padding: 0 14px;
  color: #173247;
  background: rgba(255, 255, 255, 0.82);
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}

.auth-form input::placeholder {
  color: #9aafbe;
}

.auth-form input:focus {
  border-color: #4a9fff;
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(74, 159, 255, 0.14);
}

.password-row,
.code-row {
  display: grid;
  gap: 10px;
}

.password-row {
  grid-template-columns: minmax(0, 1fr) 70px;
}

.code-row {
  grid-template-columns: minmax(0, 1fr) 116px;
}

.icon-button,
.code-button,
.primary-button,
.action-links button {
  border: 0;
  cursor: pointer;
}

.icon-button,
.code-button {
  height: 48px;
  border-radius: 12px;
  color: #1b7b92;
  background: #e7f6ff;
  border: 1px solid rgba(74, 159, 255, 0.2);
  font-size: 13px;
  font-weight: 800;
}

.code-button {
  color: #078f82;
  background: #e4fbf7;
}

.primary-button {
  height: 50px;
  border-radius: 14px;
  color: #ffffff;
  background: linear-gradient(135deg, #4a9fff, #00c8b8);
  box-shadow: 0 16px 34px rgba(56, 155, 218, 0.26);
  font-weight: 900;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;
}

.primary-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 20px 42px rgba(56, 155, 218, 0.34);
}

.primary-button:disabled,
.code-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: none;
}

.action-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 2px;
}

.action-links button {
  padding: 0;
  color: #2e77ad;
  background: transparent;
  font-size: 14px;
  font-weight: 800;
}

.form-message {
  min-height: 22px;
  margin: -2px 0 0;
  font-size: 14px;
  line-height: 1.6;
}

.form-message.success {
  color: #078f82;
}

.form-message.error {
  color: #be4b52;
}

.mode-label {
  position: absolute;
  right: 24px;
  bottom: 18px;
  color: rgba(84, 113, 135, 0.46);
  font-size: 12px;
  font-weight: 800;
}

.visual-panel {
  min-height: 430px;
  padding: clamp(24px, 4vw, 38px);
  align-self: center;
}

.panel-header {
  display: grid;
  gap: 8px;
}

.panel-header span {
  color: #4a9fff;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.panel-header strong {
  color: #173247;
  font-size: 26px;
}

.wave-chart {
  display: grid;
  place-items: center;
  min-height: 210px;
  margin-top: 24px;
  border-radius: 18px;
  background:
    linear-gradient(rgba(74, 159, 255, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(74, 159, 255, 0.08) 1px, transparent 1px), rgba(255, 255, 255, 0.52);
  background-size: 32px 32px;
}

.wave-chart svg {
  width: min(100%, 420px);
  filter: drop-shadow(0 14px 22px rgba(74, 159, 255, 0.16));
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 22px;
}

.metric-grid div {
  padding: 16px;
  border: 1px solid rgba(117, 158, 194, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
}

.metric-grid span {
  display: block;
  color: #6d8496;
  font-size: 13px;
}

.metric-grid strong {
  display: block;
  margin-top: 8px;
  color: #078f82;
  font-size: 24px;
}

.page-footer {
  position: absolute;
  right: clamp(20px, 4vw, 48px);
  bottom: 18px;
  color: #7790a3;
  font-size: 12px;
}

@keyframes textureShift {
  from {
    transform: translate3d(-18px, 10px, 0) scale(1);
  }

  to {
    transform: translate3d(18px, -12px, 0) scale(1.03);
  }
}

@keyframes particleFloat {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.32;
  }

  50% {
    transform: translateY(-18px);
    opacity: 0.72;
  }
}

@media (max-width: 940px) {
  .research-login {
    grid-template-columns: 1fr;
    justify-items: center;
    gap: 24px;
    padding: 26px 18px 58px;
  }

  .auth-card,
  .visual-panel {
    width: min(520px, 100%);
  }

  .visual-panel {
    min-height: auto;
  }
}

@media (max-width: 520px) {
  .auth-card,
  .visual-panel {
    border-radius: 18px;
  }

  .auth-card {
    padding: 24px 18px 44px;
  }

  .password-row,
  .code-row {
    grid-template-columns: 1fr;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .page-footer {
    left: 18px;
    right: 18px;
    text-align: center;
  }
}
</style>
