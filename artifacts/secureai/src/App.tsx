import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import NotFound from './pages/not-found';
import Login from './pages/Login';
import Register from './pages/Register';
import Enroll from './pages/Enroll';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import SecurityLogs from './pages/SecurityLogs';
import Threats from './pages/Threats';
import Payments from './pages/Payments';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/register" component={Register} />
      
      <Route path="/dashboard">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/users">
        <Layout><Users /></Layout>
      </Route>
      <Route path="/security-logs">
        <Layout><SecurityLogs /></Layout>
      </Route>
      <Route path="/threats">
        <Layout><Threats /></Layout>
      </Route>
      <Route path="/payments">
        <Layout><Payments /></Layout>
      </Route>
      <Route path="/enroll">
        <Layout><Enroll /></Layout>
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
