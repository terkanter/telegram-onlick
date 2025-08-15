import type { FC } from '../lib/teact/teact';
import { useEffect, useState } from '../lib/teact/teact';

import styles from './Login.module.scss';
import InputText from "./ui/InputText.tsx";
import Button from "./ui/Button.tsx";

type LoginProps = {
  onLogin: () => void;
};

const Login: FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState<string>();
  const [error, setError] = useState('');

  const handleLogin = () => {
    if (username === '123') {
      localStorage.setItem('isLoggedIn', 'true');
      onLogin();
    } else {
      setError('Incorrect code');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginBox}>
        <h1 className={styles.title}>
          This is not an official version of Telegram. If you agree to continue, please enter the code 123:
        </h1>
        {error && <p className={styles.error}>{error}</p>}
        <InputText
          placeholder="Confirmation code"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={styles.input}
        />
        <Button onClick={handleLogin} className={styles.button}>Login</Button>
      </div>
    </div>
  );
};

export function withLogin<P extends AnyLiteral>(Component: FC<P>) {
  return function WithLogin(props: P) {
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(Boolean(localStorage.getItem('isLoggedIn')));

    useEffect(() => {
      const loggedInStatus = localStorage.getItem('isLoggedIn');
      setIsLoggedIn(Boolean(loggedInStatus));
    }, []);

    function handleLogin() {
      setIsLoggedIn(true);
    }

    if (!isLoggedIn) {
      return <Login onLogin={handleLogin} />;
    }

    return <Component {...props} />;
  };
}

export default Login;
