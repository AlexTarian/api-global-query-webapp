document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
  const client = window.globalQuerySupabase;
  let passwordRecoveryActive = false;
  const isInvite = window.location.hash.includes('type=invite');

  bindAuthEvents();

  client.auth.onAuthStateChange((event, newSession) => {
    console.log('Supabase auth event:', event);

    if (event === 'PASSWORD_RECOVERY') {
      passwordRecoveryActive = true;
      showPasswordSetup('reset');
      return;
    }

    if (event === 'USER_UPDATED') return;

    if (newSession) {
      if (isInvite) {
        showPasswordSetup('setup');
      } else if (!passwordRecoveryActive) {
        showGlobalQuery(newSession);
      }
    } else {
      showLogin();
    }
  });

  const { data: { session }, error } = await client.auth.getSession();

  if (error) {
    console.error('Could not read Supabase session:', error);
    showLogin();
    return;
  }

  if (session) {
    if (isInvite) {
      showPasswordSetup('setup');
    } else if (!passwordRecoveryActive) {
      showGlobalQuery(session);
    }
  } else {
    showLogin();
  }
}

function bindAuthEvents() {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('passwordSetupForm').addEventListener('submit', handlePasswordSetup);
  document.getElementById('forgotPasswordButton').addEventListener('click', handleForgotPassword);
  document.getElementById('signOutButton').addEventListener('click', handleSignOut);
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const message = document.getElementById('loginMessage');

  message.textContent = 'Signing in...';

  try {
    console.log('Attempting Supabase sign-in for:', email);

    const { data, error } = await window.globalQuerySupabase.auth.signInWithPassword({ email, password });

    console.log('Supabase sign-in response:', { data, error });

    if (error) {
      message.textContent = error.message;
      console.error('Supabase sign-in failed:', error);
      return;
    }

    if (!data?.session) {
      message.textContent = 'Sign-in succeeded, but no session was returned.';
      console.warn('No session returned:', data);
      return;
    }

    console.log('Supabase session established:', data.session.user.email);
    showGlobalQuery(data.session);

  } catch (error) {
    console.error('Unexpected login error:', error);
    message.textContent = 'Login failed. Check the browser console for details.';
  }
}

async function handlePasswordSetup(event) {
  event.preventDefault();

  const password = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const message = document.getElementById('passwordSetupMessage');

  if (password.length < 8) {
    message.textContent = 'Password must be at least 8 characters.';
    return;
  }

  if (password !== confirmPassword) {
    message.textContent = 'Passwords do not match.';
    return;
  }

  message.textContent = 'Saving password...';

  try {
    const { data, error } = await window.globalQuerySupabase.auth.updateUser({ password });

    if (error) {
      console.error('Password update failed:', error);
      message.textContent = error.message;
      return;
    }

    console.log('Password updated for:', data?.user?.email);

    const { data: { session }, error: sessionError } =
      await window.globalQuerySupabase.auth.getSession();

    if (sessionError) {
      console.error('Could not read session after password update:', sessionError);
      message.textContent = 'Password saved, but the session could not be loaded.';
      return;
    }

    if (session) {
      window.history.replaceState({}, document.title, window.location.pathname);
      showGlobalQuery(session);
    } else {
      message.textContent = 'Password saved. Please sign in.';
      showLogin();
    }

  } catch (error) {
    console.error('Unexpected password update error:', error);
    message.textContent = 'Could not save the password.';
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  const message = document.getElementById('loginMessage');

  if (!email) {
    message.textContent = 'Enter your email address first.';
    document.getElementById('loginEmail').focus();
    return;
  }

  message.textContent = 'Sending password reset email...';

  try {
    const { error } = await window.globalQuerySupabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    });

    if (error) {
      console.error('Password reset request failed:', error);
      message.textContent = error.message;
      return;
    }

    message.textContent = 'Check your email for a password reset link.';
  } catch (error) {
    console.error('Unexpected password reset error:', error);
    message.textContent = 'Could not send the password reset email.';
  }
}

async function handleSignOut() {
  const { error } = await window.globalQuerySupabase.auth.signOut();

  if (error) {
    console.error('Could not sign out:', error);
    return;
  }

  showLogin();
}

function showLogin() {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('loginPanel').hidden = false;
  document.getElementById('passwordSetupPanel').hidden = true;
  document.getElementById('globalQueryApp').hidden = true;
}

function showPasswordSetup(mode = 'setup') {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('loginPanel').hidden = true;
  document.getElementById('passwordSetupPanel').hidden = false;
  document.getElementById('globalQueryApp').hidden = true;

  const title = document.getElementById('passwordSetupTitle');

  if (title) {
    title.textContent = mode === 'reset'
      ? 'Reset Password'
      : 'Set Password';
  }

  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('passwordSetupMessage').textContent = '';
}

function showGlobalQuery(session) {
  document.getElementById('authScreen').hidden = true;
  document.getElementById('globalQueryApp').hidden = false;

  document.getElementById('signedInUser').textContent = session?.user?.email
    ? `Signed in as ${session.user.email}`
    : 'Signed in';

  if (typeof window.GlobalQueryUI?.initializeTabs === 'function') {
    window.GlobalQueryUI.initializeTabs();
  }

  if (typeof window.initializeCases === 'function') {
    window.initializeCases();
  }
}
