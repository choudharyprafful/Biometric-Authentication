import React, { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useRegisterUser } from '@workspace/api-client-react';
import { Card, Input, Label, Button } from '../components/ui';
import { Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  
  const [, setLocation] = useLocation();
  const registerMutation = useRegisterUser();
  const { refetchUser } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (password !== confirmPassword) {
      setError('Passkeys do not match.');
      return;
    }
    
    try {
      await registerMutation.mutateAsync({ data: { name, email, password } });
      await refetchUser();
      setLocation('/enroll');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Registration sequence failed.');
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <Shield className="w-10 h-10 text-primary mb-4" />
        <h1 className="font-mono text-2xl tracking-widest uppercase text-foreground">New Operator Onboarding</h1>
      </div>

      <Card className="w-full max-w-md relative overflow-hidden border-t-2 border-t-primary">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Designation (Name)</Label>
              <Input 
                id="name" 
                required 
                value={name}
                onChange={e => setName(e.target.value)}
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Operator ID (Email)</Label>
              <Input 
                id="email" 
                type="email" 
                required 
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passkey</Label>
              <Input 
                id="password" 
                type="password" 
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                data-testid="input-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Passkey</Label>
              <Input 
                id="confirmPassword" 
                type="password" 
                required
                minLength={8}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
          </div>
          
          {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}
          
          <Button 
            type="submit" 
            className="w-full" 
            isLoading={registerMutation.isPending}
            data-testid="button-register"
          >
            Issue Clearance
          </Button>
          
          <div className="text-center pt-4 border-t border-border">
            <Link href="/">
              <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                Return to Authentication
              </span>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
