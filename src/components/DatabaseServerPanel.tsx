/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { AppDatabase, User, UserRoleDefinition } from '../types';
import {
  Server, Database, RefreshCw, Upload, Download, Users, Shield, Plus,
  Edit3, Trash2, CheckCircle, AlertTriangle, HardDrive, Link, Activity, Lock, ChevronDown, ChevronUp, KeyRound,
  Building2, Copy, QrCode, ArrowLeftRight
} from 'lucide-react';
import { toPersianDigits } from '../utils/persianUtils';
import { nextSimpleId } from '../utils/simpleId';
import { DEFAULT_USER_ROLES, SYSTEM_TABS, isAdminUser, isFullAccessRole, normalizePermissions } from '../shared/rbac';
import { DEFAULT_BRANCHES, DEFAULT_BRANCH_ID, normalizeAllowedBranches } from '../shared/branches';
import {
  createLocalBranch,
  updateLocalBranch,
  deleteLocalBranch,
  getLocalBranches,
  saveSharedLocalAuth,
} from '../db';
import {
  type ServerDbStatus,
  type AuditLogItem,
  type BranchStatusItem,
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  fetchAdminRoles,
  createAdminRole,
  updateAdminRole,
  deleteAdminRole,
  fetchAuditLogs,
  fetchBranches,
  createAdminBranch,
  updateAdminBranch,
  deleteAdminBranch,
} from '../services/postgresSyncService';

interface DatabaseServerPanelProps {
  db: AppDatabase;
  currentUser: User;
  serverStatus: ServerDbStatus | null;
  pgSyncState: 'synced' | 'syncing' | 'error' | 'offline';
  lastPgSyncTime: string;
  branches?: BranchStatusItem[];
  activeBranchId?: string;
  onSwitchBranch?: (branchId: string) => Promise<void> | void;
  onBranchesChanged?: (branches: BranchStatusItem[]) => void;
  onOpenCopyFromBranch?: () => void;
  onRefreshStatusAndPull: () => Promise<void>;
  onMigrateLocalToPostgres: () => Promise<void>;
  onUpdateDb: (nextDb: AppDatabase) => void;
  onOpenBackupPanel: () => void;
  // Legacy SQL Server & Sheets props
  sqlServerUrl: string;
  setSqlServerUrl: (val: string) => void;
  sqlServerApiKey: string;
  setSqlServerApiKey: (val: string) => void;
  sqlServerAutoSync: boolean;
  setSqlServerAutoSync: (val: boolean) => void;
  isSqlServerTesting: boolean;
  isSqlServerSyncing: boolean;
  sqlServerStatusMessage: { type: 'success' | 'error' | 'info'; text: string } | null;
  onTestSqlServerConnection: () => void;
  onSaveToSqlServer: () => void;
  onRestoreFromSqlServer: () => void;
  onDownloadSqlServerScript: () => void;
}

function getEffectiveLocalRoles(db: AppDatabase): UserRoleDefinition[] {
  const base = Array.isArray(db.roles) && db.roles.length > 0 ? db.roles : DEFAULT_USER_ROLES;
  const seen = new Set(base.map((r) => r.name));
  const combined = base.map((r) => ({ ...r, permissions: normalizePermissions(r.permissions) }));
  (db.users || []).forEach((u: any, idx: number) => {
    const rName = String(u?.role || '').trim();
    if (rName && !seen.has(rName)) {
      seen.add(rName);
      combined.push({
        id: `role-local-${idx}-${rName.slice(0, 10)}`,
        name: rName,
        description: '',
        permissions: normalizePermissions(Array.isArray(u.permissions) ? u.permissions : []),
        isSystem: rName === 'مدیر ارشد',
      });
    }
  });
  return combined;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '۰ بایت';
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} KB`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(2))} MB`;
}

export default function DatabaseServerPanel({
  db,
  currentUser,
  serverStatus,
  pgSyncState,
  lastPgSyncTime,
  branches,
  activeBranchId = DEFAULT_BRANCH_ID,
  onSwitchBranch,
  onBranchesChanged,
  onOpenCopyFromBranch,
  onRefreshStatusAndPull,
  onMigrateLocalToPostgres,
  onUpdateDb,
  onOpenBackupPanel,
  sqlServerUrl,
  setSqlServerUrl,
  sqlServerApiKey,
  setSqlServerApiKey,
  sqlServerAutoSync,
  setSqlServerAutoSync,
  isSqlServerTesting,
  isSqlServerSyncing,
  sqlServerStatusMessage,
  onTestSqlServerConnection,
  onSaveToSqlServer,
  onRestoreFromSqlServer,
  onDownloadSqlServerScript,
}: DatabaseServerPanelProps) {
  const isAdmin = isAdminUser(currentUser);
  const isPgConnected = Boolean(serverStatus?.mode === 'postgres' && serverStatus?.connected);

  const [isBusy, setIsBusy] = useState(false);
  const [usersList, setUsersList] = useState<User[]>(db.users || []);
  const [rolesList, setRolesList] = useState<UserRoleDefinition[]>(() => getEffectiveLocalRoles(db));
  const [branchList, setBranchList] = useState<BranchStatusItem[]>(() =>
    branches && branches.length > 0 ? branches : getLocalBranches()
  );
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [showLegacySql, setShowLegacySql] = useState(false);

  // Branch Add/Edit modal state
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchStatusItem | null>(null);
  const [branchNameInput, setBranchNameInput] = useState('');
  const [branchSlugInput, setBranchSlugInput] = useState('');
  const [branchDbNameInput, setBranchDbNameInput] = useState('');
  const [branchAddressInput, setBranchAddressInput] = useState('');
  const [branchPhoneInput, setBranchPhoneInput] = useState('');
  const [branchIsActiveInput, setBranchIsActiveInput] = useState(true);
  const [branchFormError, setBranchFormError] = useState('');

  // User Add/Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [formUsername, setFormUsername] = useState('');
  const [formFullName, setFormFullName] = useState('');
  const [formRole, setFormRole] = useState<string>('حسابدار');
  const [formPassword, setFormPassword] = useState('');
  const [formPermissions, setFormPermissions] = useState<string[]>(['items', 'sales']);
  const [formAllowedBranches, setFormAllowedBranches] = useState<string[]>(['*']);
  const [formIs2FA, setFormIs2FA] = useState(false);
  const [formSecretCode, setFormSecretCode] = useState('123456');
  const [formIsActive, setFormIsActive] = useState(true);
  const [userFormError, setUserFormError] = useState('');

  // Role Add/Edit modal state
  const [editingRole, setEditingRole] = useState<UserRoleDefinition | null>(null);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [roleNameInput, setRoleNameInput] = useState('');
  const [roleDescInput, setRoleDescInput] = useState('');
  const [rolePermsInput, setRolePermsInput] = useState<string[]>(['items']);
  const [roleFullAccessInput, setRoleFullAccessInput] = useState(false);
  const [applyRolePermsToUsers, setApplyRolePermsToUsers] = useState(true);
  const [roleFormError, setRoleFormError] = useState('');

  useEffect(() => {
    if (branches && branches.length > 0) {
      setBranchList(branches);
    }
  }, [branches]);

  const loadPgAdminData = async () => {
    if (!isPgConnected || !isAdmin) {
      setUsersList(db.users || []);
      setRolesList(getEffectiveLocalRoles(db));
      setBranchList(branches && branches.length > 0 ? branches : getLocalBranches());
      return;
    }
    const [uRes, rRes, bRes, logsRes] = await Promise.all([
      fetchAdminUsers(),
      fetchAdminRoles(),
      fetchBranches(),
      fetchAuditLogs(40),
    ]);
    if (uRes.ok) setUsersList(uRes.users);
    if (rRes.ok && rRes.roles.length > 0) {
      setRolesList(rRes.roles);
    }
    if (bRes.ok && bRes.branches.length > 0) {
      setBranchList(bRes.branches);
      onBranchesChanged?.(bRes.branches);
    }
    setAuditLogs(logsRes);
  };

  useEffect(() => {
    loadPgAdminData();
  }, [isPgConnected, isAdmin, db.users, db.roles, activeBranchId]);

  const rolePermissionsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    rolesList.forEach((r) => {
      map.set(r.name, normalizePermissions(r.permissions));
    });
    return map;
  }, [rolesList]);

  const userCountByRole = useMemo(() => {
    const counts = new Map<string, number>();
    usersList.forEach((u: any) => {
      const rName = String(u?.role || '').trim();
      if (rName) counts.set(rName, (counts.get(rName) || 0) + 1);
    });
    return counts;
  }, [usersList]);

  const getPresetForRole = (roleName: string): string[] => {
    if (roleName === 'مدیر ارشد') return ['*'];
    const found = rolePermissionsMap.get(roleName);
    if (found) return [...found];
    const def = DEFAULT_USER_ROLES.find((r) => r.name === roleName);
    return def ? [...def.permissions] : ['items'];
  };

  const openCreateUserModal = () => {
    const defaultRoleObj = rolesList.find((r) => r.name === 'حسابدار')
      || rolesList.find((r) => !isFullAccessRole(r))
      || rolesList[0];
    const defaultRoleName = defaultRoleObj?.name || 'حسابدار';
    setEditingUser(null);
    setFormUsername('');
    setFormFullName('');
    setFormRole(defaultRoleName);
    setFormPassword('');
    setFormPermissions(getPresetForRole(defaultRoleName));
    setFormAllowedBranches(['*']);
    setFormIs2FA(false);
    setFormSecretCode('123456');
    setFormIsActive(true);
    setUserFormError('');
    setIsUserModalOpen(true);
  };

  const openEditUserModal = (u: any) => {
    setEditingUser(u);
    setFormUsername(u.username || '');
    setFormFullName(u.fullName || u.name || '');
    setFormRole(String(u.role || 'کاربر انبار'));
    setFormPassword('');
    setFormPermissions(Array.isArray(u.permissions) ? u.permissions : []);
    setFormAllowedBranches(normalizeAllowedBranches(u.allowedBranches));
    setFormIs2FA(Boolean(u.is2FA));
    setFormSecretCode(u.secretCode || '123456');
    setFormIsActive(u.isActive !== false);
    setUserFormError('');
    setIsUserModalOpen(true);
  };

  const handleRoleChange = (nextRole: string) => {
    setFormRole(nextRole);
    if (!editingUser || editingUser.role !== nextRole) {
      setFormPermissions(getPresetForRole(nextRole));
    }
    if (nextRole === 'مدیر ارشد') {
      setFormAllowedBranches(['*']);
    }
  };

  const togglePermission = (tabId: string) => {
    if (tabId === '*') {
      setFormPermissions(formPermissions.includes('*') ? [] : ['*']);
      return;
    }
    const cleaned = formPermissions.filter((p) => p !== '*');
    if (cleaned.includes(tabId)) {
      setFormPermissions(cleaned.filter((p) => p !== tabId));
    } else {
      setFormPermissions([...cleaned, tabId]);
    }
  };

  const toggleAllowedBranch = (branchId: string) => {
    if (branchId === '*') {
      if (formAllowedBranches.includes('*')) {
        setFormAllowedBranches([activeBranchId || DEFAULT_BRANCH_ID]);
      } else {
        setFormAllowedBranches(['*']);
      }
      return;
    }
    const cleaned = formAllowedBranches.filter((b) => b !== '*');
    if (cleaned.includes(branchId)) {
      setFormAllowedBranches(cleaned.filter((b) => b !== branchId));
    } else {
      setFormAllowedBranches([...cleaned, branchId]);
    }
  };

  // Branch Modal Handlers
  const openCreateBranchModal = () => {
    setEditingBranch(null);
    setBranchNameInput('');
    setBranchSlugInput('');
    setBranchDbNameInput('');
    setBranchAddressInput('');
    setBranchPhoneInput('');
    setBranchIsActiveInput(true);
    setBranchFormError('');
    setIsBranchModalOpen(true);
  };

  const openEditBranchModal = (b: BranchStatusItem) => {
    setEditingBranch(b);
    setBranchNameInput(b.name || '');
    setBranchSlugInput(b.slug || '');
    setBranchDbNameInput(b.dbName || '');
    setBranchAddressInput(b.address || '');
    setBranchPhoneInput(b.phone || '');
    setBranchIsActiveInput(b.isActive !== false);
    setBranchFormError('');
    setIsBranchModalOpen(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBranchFormError('');
    const cleanName = branchNameInput.trim();
    if (!cleanName) {
      setBranchFormError('وارد کردن نام شعبه الزامی است.');
      return;
    }

    if (isPgConnected) {
      setIsBusy(true);
      try {
        if (editingBranch) {
          const res = await updateAdminBranch(editingBranch.id, {
            name: cleanName,
            address: branchAddressInput.trim(),
            phone: branchPhoneInput.trim(),
            isActive: editingBranch.isDefault ? true : branchIsActiveInput,
          });
          if (!res.ok) {
            setBranchFormError(res.error || 'خطا در ویرایش شعبه');
            return;
          }
        } else {
          const res = await createAdminBranch({
            name: cleanName,
            slug: branchSlugInput.trim() || undefined,
            dbName: branchDbNameInput.trim() || undefined,
            address: branchAddressInput.trim() || undefined,
            phone: branchPhoneInput.trim() || undefined,
          });
          if (!res.ok) {
            setBranchFormError(res.error || 'خطا در ایجاد شعبه جدید و پایگاه داده مجزا');
            return;
          }
        }
        const bRes = await fetchBranches();
        if (bRes.ok) {
          setBranchList(bRes.branches);
          onBranchesChanged?.(bRes.branches);
        }
        setIsBranchModalOpen(false);
      } finally {
        setIsBusy(false);
      }
    } else {
      try {
        if (editingBranch) {
          updateLocalBranch(editingBranch.id, {
            name: cleanName,
            address: branchAddressInput.trim(),
            phone: branchPhoneInput.trim(),
            isActive: editingBranch.isDefault ? true : branchIsActiveInput,
          });
        } else {
          createLocalBranch({
            name: cleanName,
            slug: branchSlugInput.trim() || undefined,
            dbName: branchDbNameInput.trim() || undefined,
            address: branchAddressInput.trim() || undefined,
            phone: branchPhoneInput.trim() || undefined,
          });
        }
        const nextLocalBranches = getLocalBranches();
        setBranchList(nextLocalBranches);
        onBranchesChanged?.(nextLocalBranches);
        setIsBranchModalOpen(false);
      } catch (err: any) {
        setBranchFormError(err?.message || 'خطا در ذخیره اطلاعات شعبه');
      }
    }
  };

  const handleDeleteBranch = async (b: BranchStatusItem) => {
    if (b.isDefault || b.id === DEFAULT_BRANCH_ID) {
      alert('شعبه اصلی (پیش‌فرض) قابل حذف نیست.');
      return;
    }
    if (b.id === activeBranchId) {
      alert('ابتدا به شعبه دیگری وارد شوید و سپس این شعبه را حذف کنید.');
      return;
    }
    if (!window.confirm(`آیا از حذف شعبه «${b.name}» از فهرست شعبه‌ها اطمینان دارید؟`)) {
      return;
    }

    if (isPgConnected) {
      setIsBusy(true);
      try {
        const res = await deleteAdminBranch(b.id);
        if (!res.ok) {
          alert(res.error || 'خطا در حذف شعبه');
          return;
        }
        const bRes = await fetchBranches();
        if (bRes.ok) {
          setBranchList(bRes.branches);
          onBranchesChanged?.(bRes.branches);
        }
      } finally {
        setIsBusy(false);
      }
    } else {
      try {
        await deleteLocalBranch(b.id);
        const nextLocalBranches = getLocalBranches();
        setBranchList(nextLocalBranches);
        onBranchesChanged?.(nextLocalBranches);
      } catch (err: any) {
        alert(err?.message || 'خطا در حذف شعبه');
      }
    }
  };

  // Role Modal Handlers
  const openCreateRoleModal = () => {
    setEditingRole(null);
    setRoleNameInput('');
    setRoleDescInput('');
    setRolePermsInput(['items']);
    setRoleFullAccessInput(false);
    setApplyRolePermsToUsers(false);
    setRoleFormError('');
    setIsRoleModalOpen(true);
  };

  const openEditRoleModal = (role: UserRoleDefinition) => {
    const full = isFullAccessRole(role);
    setEditingRole(role);
    setRoleNameInput(role.name);
    setRoleDescInput(role.description || '');
    setRoleFullAccessInput(full);
    setRolePermsInput(
      full
        ? SYSTEM_TABS.filter((t) => t.id !== 'cloud_sync').map((t) => t.id)
        : normalizePermissions(role.permissions).filter((p) => p !== '*')
    );
    setApplyRolePermsToUsers(true);
    setRoleFormError('');
    setIsRoleModalOpen(true);
  };

  const toggleRolePermission = (tabId: string) => {
    if (rolePermsInput.includes(tabId)) {
      setRolePermsInput(rolePermsInput.filter((p) => p !== tabId));
    } else {
      setRolePermsInput([...rolePermsInput, tabId]);
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleFormError('');
    const cleanName = roleNameInput.trim();
    if (!cleanName) {
      setRoleFormError('وارد کردن نام نقش کاربری الزامی است.');
      return;
    }

    const isProtectedAdmin = Boolean(editingRole?.isSystem || editingRole?.name === 'مدیر ارشد' || cleanName === 'مدیر ارشد');
    const finalPerms = isProtectedAdmin || roleFullAccessInput
      ? ['*']
      : normalizePermissions(rolePermsInput);

    if (!isProtectedAdmin && !roleFullAccessInput && finalPerms.length === 0) {
      setRoleFormError('حداقل یک بخش مجاز برای این نقش انتخاب کنید یا دسترسی کامل را فعال نمایید.');
      return;
    }

    if (isPgConnected) {
      setIsBusy(true);
      try {
        if (editingRole) {
          const res = await updateAdminRole(editingRole.id, {
            name: cleanName,
            description: roleDescInput.trim(),
            permissions: finalPerms,
            applyToExistingUsers: applyRolePermsToUsers,
          });
          if (!res.ok) {
            setRoleFormError(res.error || 'خطا در ویرایش نقش کاربری');
            return;
          }
        } else {
          const res = await createAdminRole({
            name: cleanName,
            description: roleDescInput.trim(),
            permissions: finalPerms,
          });
          if (!res.ok) {
            setRoleFormError(res.error || 'خطا در ایجاد نقش کاربری');
            return;
          }
        }
        await loadPgAdminData();
        setIsRoleModalOpen(false);
      } finally {
        setIsBusy(false);
      }
    } else {
      const currentRoles = getEffectiveLocalRoles(db);
      const duplicate = currentRoles.find(
        (r) => r.name === cleanName && (!editingRole || r.id !== editingRole.id)
      );
      if (duplicate) {
        setRoleFormError('نقشی با این نام قبلاً تعریف شده است.');
        return;
      }

      let nextRoles: UserRoleDefinition[];
      let nextUsers = [...(db.users || [])];

      if (editingRole) {
        const oldName = editingRole.name;
        nextRoles = currentRoles.map((r) =>
          r.id === editingRole.id
            ? {
                ...r,
                name: cleanName,
                description: roleDescInput.trim(),
                permissions: finalPerms,
                isSystem: isProtectedAdmin,
              }
            : r
        );
        if (oldName !== cleanName || applyRolePermsToUsers) {
          nextUsers = nextUsers.map((u: any) => {
            if (u.role !== oldName) return u;
            return {
              ...u,
              role: cleanName,
              permissions: applyRolePermsToUsers ? finalPerms : u.permissions,
            };
          });
        }
      } else {
        const newRole: UserRoleDefinition = {
          id: nextSimpleId(currentRoles, 'role'),
          name: cleanName,
          description: roleDescInput.trim(),
          permissions: finalPerms,
          isSystem: false,
        };
        nextRoles = [...currentRoles, newRole];
      }

      saveSharedLocalAuth(nextUsers, nextRoles);
      onUpdateDb({ ...db, roles: nextRoles, users: nextUsers });
      setIsRoleModalOpen(false);
    }
  };

  const handleDeleteRole = async (role: UserRoleDefinition) => {
    if (role.isSystem || role.name === 'مدیر ارشد') {
      alert('نقش سیستمی «مدیر ارشد» قابل حذف نیست.');
      return;
    }
    const assignedCount = userCountByRole.get(role.name) || 0;
    if (assignedCount > 0) {
      alert(`این نقش هم‌اکنون به ${toPersianDigits(assignedCount)} کاربر اختصاص دارد. ابتدا نقش کاربران مرتبط را تغییر دهید.`);
      return;
    }
    if (!window.confirm(`آیا از حذف نقش «${role.name}» اطمینان دارید؟`)) {
      return;
    }

    if (isPgConnected) {
      setIsBusy(true);
      try {
        const res = await deleteAdminRole(role.id);
        if (!res.ok) {
          alert(res.error || 'خطا در حذف نقش کاربری');
          return;
        }
        await loadPgAdminData();
      } finally {
        setIsBusy(false);
      }
    } else {
      const nextRoles = getEffectiveLocalRoles(db).filter((r) => r.id !== role.id);
      saveSharedLocalAuth(db.users || [], nextRoles);
      onUpdateDb({ ...db, roles: nextRoles });
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');

    if (!formUsername.trim()) {
      setUserFormError('نام کاربری الزامی است.');
      return;
    }
    if (!editingUser && !formPassword.trim()) {
      setUserFormError('رمز عبور برای کاربر جدید الزامی است.');
      return;
    }

    const finalPerms = formRole === 'مدیر ارشد' || formPermissions.includes('*')
      ? ['*']
      : formPermissions;

    const finalAllowedBranches =
      formRole === 'مدیر ارشد' || formAllowedBranches.includes('*')
        ? ['*']
        : formAllowedBranches.filter(Boolean);

    if (finalAllowedBranches.length === 0) {
      setUserFormError('حداقل یک شعبه مجاز برای کاربر انتخاب کنید یا دسترسی به همه شعبه‌ها را فعال نمایید.');
      return;
    }

    if (isPgConnected) {
      setIsBusy(true);
      try {
        if (editingUser) {
          const res = await updateAdminUser(editingUser.id, {
            username: formUsername.trim(),
            fullName: formFullName.trim() || formUsername.trim(),
            role: formRole,
            permissions: finalPerms,
            allowedBranches: finalAllowedBranches,
            password: formPassword.trim() ? formPassword.trim() : undefined,
            is2FA: formIs2FA,
            secretCode: formSecretCode.trim() || '123456',
            isActive: formIsActive,
          });
          if (!res.ok) {
            setUserFormError(res.error || 'خطا در ویرایش کاربر');
            return;
          }
        } else {
          const res = await createAdminUser({
            username: formUsername.trim(),
            fullName: formFullName.trim() || formUsername.trim(),
            role: formRole,
            permissions: finalPerms,
            allowedBranches: finalAllowedBranches,
            password: formPassword.trim(),
            is2FA: formIs2FA,
            secretCode: formSecretCode.trim() || '123456',
            isActive: formIsActive,
          });
          if (!res.ok) {
            setUserFormError(res.error || 'خطا در ایجاد کاربر');
            return;
          }
        }
        await loadPgAdminData();
        setIsUserModalOpen(false);
      } finally {
        setIsBusy(false);
      }
    } else {
      // Local / Offline mode fallback
      const currentUsers = [...(db.users || [])];
      if (editingUser) {
        const updatedUsers = currentUsers.map((u) =>
          u.id === editingUser.id
            ? {
                ...u,
                username: formUsername.trim(),
                fullName: formFullName.trim() || formUsername.trim(),
                role: formRole,
                permissions: finalPerms,
                allowedBranches: finalAllowedBranches,
                password: formPassword.trim() ? formPassword.trim() : u.password,
                is2FA: formIs2FA,
                secretCode: formSecretCode.trim() || '123456',
              }
            : u
        );
        saveSharedLocalAuth(updatedUsers, getEffectiveLocalRoles(db));
        onUpdateDb({ ...db, users: updatedUsers });
      } else {
        if (currentUsers.some((u) => u.username === formUsername.trim())) {
          setUserFormError('این نام کاربری قبلاً ثبت شده است.');
          return;
        }
        const newUser: User = {
          id: nextSimpleId(currentUsers, 'usr'),
          username: formUsername.trim(),
          fullName: formFullName.trim() || formUsername.trim(),
          role: formRole,
          permissions: finalPerms,
          allowedBranches: finalAllowedBranches,
          password: formPassword.trim(),
          is2FA: formIs2FA,
          secretCode: formSecretCode.trim() || '123456',
        };
        const updatedUsers = [...currentUsers, newUser];
        saveSharedLocalAuth(updatedUsers, getEffectiveLocalRoles(db));
        onUpdateDb({ ...db, users: updatedUsers });
      }
      setIsUserModalOpen(false);
    }
  };

  const handleDeleteUser = async (u: User) => {
    if (u.id === currentUser.id || u.username === currentUser.username) {
      alert('شما نمی‌توانید کاربر جاری خودتان را حذف کنید.');
      return;
    }
    if (!window.confirm(`آیا از حذف کاربر "${u.fullName || u.username}" اطمینان دارید؟`)) {
      return;
    }
    if (isPgConnected) {
      setIsBusy(true);
      try {
        const res = await deleteAdminUser(u.id);
        if (!res.ok) {
          alert(res.error || 'خطا در حذف کاربر');
          return;
        }
        await loadPgAdminData();
      } finally {
        setIsBusy(false);
      }
    } else {
      const remaining = (db.users || []).filter((item) => item.id !== u.id);
      saveSharedLocalAuth(remaining, getEffectiveLocalRoles(db));
      onUpdateDb({
        ...db,
        users: remaining,
      });
    }
  };

  const handleManualPull = async () => {
    setIsBusy(true);
    try {
      await onRefreshStatusAndPull();
      await loadPgAdminData();
    } finally {
      setIsBusy(false);
    }
  };

  const handleManualPushMigration = async () => {
    setIsBusy(true);
    try {
      await onMigrateLocalToPostgres();
      await loadPgAdminData();
    } finally {
      setIsBusy(false);
    }
  };

  const totalPgRecords = serverStatus?.collectionCounts
    ? Object.values(serverStatus.collectionCounts).reduce((sum, n) => sum + (Number(n) || 0), 0)
    : 0;

  return (
    <div className="bg-[#121214] p-3.5 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-800/80 shadow-2xl text-right space-y-4 sm:space-y-6 animate-fade-in font-sans" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <Server className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400 shrink-0" />
            مدیریت پایگاه داده مشترک (PostgreSQL) و کاربران
          </h2>
          <p className="hidden sm:block text-xs text-zinc-400 mt-1.5 leading-relaxed">
            تمامی داده‌های کالا، فروش، فرمولاسیون، حقوق و خزانه به صورت متمرکز در پایگاه داده PostgreSQL روی سرور Ubuntu 24 ذخیره شده و با سطح دسترسی تفکیک‌شده (RBAC) بین تمامی کاربران به اشتراک گذاشته می‌شوند.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenBackupPanel}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md transition-all shrink-0"
        >
          <Download className="h-4 w-4" /> پشتیبان روزانه و بازیابی دیتابیس
        </button>
      </div>

      {/* PostgreSQL Live Status Card */}
      <div className={`p-5 rounded-2xl border space-y-4 ${
        isPgConnected
          ? 'bg-emerald-950/15 border-emerald-800/40'
          : 'bg-zinc-900 border-zinc-800'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">وضعیت اتصال پایگاه داده:</span>
              {isPgConnected ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-bold bg-emerald-950/60 border border-emerald-700/50 px-3 py-1 rounded-lg">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  متصل به PostgreSQL سرور (اشتراک‌گذاری زنده فعال)
                </span>
              ) : serverStatus?.configured ? (
                <span className="inline-flex items-center gap-1.5 text-rose-400 text-xs font-bold bg-rose-950/40 border border-rose-800/50 px-3 py-1 rounded-lg">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  خطا در اتصال به PostgreSQL: {serverStatus.error || 'پاسخی دریافت نشد'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-300 text-xs font-bold bg-amber-950/30 border border-amber-700/40 px-3 py-1 rounded-lg">
                  <HardDrive className="h-3.5 w-3.5" />
                  حالت آفلاین / پیش‌نمایش محلی (IndexedDB) — آماده استقرار روی سرور Ubuntu 24
                </span>
              )}
            </div>

            <div className="text-[11px] text-zinc-400 flex flex-wrap gap-x-5 gap-y-1">
              {isPgConnected ? (
                <>
                  <span>بانک اطلاعاتی: <strong className="text-zinc-200 font-mono">{serverStatus?.databaseName}</strong> ({serverStatus?.dbVersion})</span>
                  <span>حجم دیتابیس: <strong className="text-emerald-400">{formatBytes(serverStatus?.dbSizeBytes)}</strong></span>
                  <span>مجموع رکوردها: <strong className="text-emerald-400 font-mono">{toPersianDigits(totalPgRecords)}</strong></span>
                  <span>نشست‌های فعال: <strong className="text-sky-400 font-mono">{toPersianDigits(serverStatus?.activeSessionsCount || 1)}</strong> کاربر</span>
                  {lastPgSyncTime && (
                    <span>آخرین همگام‌سازی: <strong className="text-zinc-300">{lastPgSyncTime}</strong></span>
                  )}
                </>
              ) : (
                <span>
                  برای فعال‌سازی اتصال دائمی به PostgreSQL روی سرور Ubuntu 24، متغیر <code className="font-mono text-emerald-400 bg-zinc-950 px-1.5 py-0.5 rounded">DATABASE_URL</code> را در فایل <code className="font-mono text-emerald-400 bg-zinc-950 px-1.5 py-0.5 rounded">.env</code> سرور تنظیم و سرویس را اجرا نمایید.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleManualPull}
              className="bg-zinc-800 hover:bg-zinc-750 text-zinc-100 border border-zinc-700 text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className={`h-4 w-4 text-emerald-400 ${isBusy || pgSyncState === 'syncing' ? 'animate-spin' : ''}`} />
              {isPgConnected ? 'بروزرسانی از PostgreSQL' : 'بررسی مجدد اتصال سرور'}
            </button>

            {isPgConnected && isAdmin && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleManualPushMigration}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg transition-all"
              >
                <Upload className="h-4 w-4" />
                ارسال / جایگزینی کل داده‌های فعلی در PostgreSQL
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Multi-Branch Management Section (Admin Only) */}
      {isAdmin && (
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="h-4.5 w-4.5 text-emerald-400" />
                مدیریت شعبه‌ها و دیتابیس‌های مجزا ({toPersianDigits(branchList.length)} شعبه)
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                هر شعبه دارای پایگاه داده فیزیکی مستقل (PostgreSQL / IndexedDB) و منوی QR اختصاصی است؛ کاربران به‌صورت مشترک مدیریت می‌شوند.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {branchList.length > 1 && onOpenCopyFromBranch && (
                <button
                  type="button"
                  onClick={onOpenCopyFromBranch}
                  className="bg-zinc-800 hover:bg-zinc-750 text-sky-300 border border-sky-700/40 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <Copy className="h-4 w-4" /> کپی اطلاعات از شعبه دیگر
                </button>
              )}
              <button
                type="button"
                onClick={openCreateBranchModal}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Plus className="h-4 w-4" /> افزودن شعبه جدید
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {branchList.map((branch) => {
              const isCurrent = branch.id === activeBranchId;
              const menuPath = branch.isDefault ? '/menu' : `/menu/${branch.slug}`;
              return (
                <div
                  key={branch.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                    isCurrent
                      ? 'bg-emerald-950/20 border-emerald-600/50'
                      : 'bg-zinc-950/60 border-zinc-800'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-black text-white">{branch.name}</span>
                          {isCurrent && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-600 text-white">
                              شعبه فعال
                            </span>
                          )}
                          {branch.isDefault && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                              اصلی
                            </span>
                          )}
                          {branch.isActive === false && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-950/60 text-rose-300 border border-rose-800/50">
                              غیرفعال
                            </span>
                          )}
                        </div>
                        {(branch.address || branch.phone) && (
                          <div className="text-[11px] text-zinc-400 mt-1 truncate">
                            {[branch.address, branch.phone].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditBranchModal(branch)}
                          className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-sky-400 rounded-lg cursor-pointer transition-colors"
                          title="ویرایش مشخصات شعبه"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        {!branch.isDefault && branch.id !== DEFAULT_BRANCH_ID && !isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleDeleteBranch(branch)}
                            className="p-1.5 bg-zinc-800 hover:bg-rose-950 text-rose-400 rounded-lg cursor-pointer transition-colors"
                            title="حذف شعبه از فهرست"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/90 flex items-center justify-between gap-2">
                        <span className="text-zinc-500">دیتابیس:</span>
                        <span className="font-mono text-zinc-200 truncate" dir="ltr">
                          {branch.dbName}
                        </span>
                      </div>
                      <div className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/90 flex items-center justify-between gap-2">
                        <span className="text-zinc-500 flex items-center gap-1">
                          <QrCode className="h-3 w-3 text-emerald-400" />
                          منوی QR:
                        </span>
                        <span className="font-mono text-emerald-400 truncate" dir="ltr">
                          {menuPath}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70 text-[11px]">
                    <span className="text-zinc-400">
                      {isPgConnected
                        ? branch.databaseExists
                          ? `PostgreSQL آماده · ${formatBytes(branch.dbSizeBytes)}`
                          : 'دیتابیس در اولین ورود ایجاد می‌شود'
                        : 'فضای مجزای مرورگر (IndexedDB)'}
                    </span>
                    {!isCurrent && branch.isActive !== false && onSwitchBranch && (
                      <button
                        type="button"
                        onClick={() => onSwitchBranch(branch.id)}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-600 text-zinc-200 hover:text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        ورود به این شعبه
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RBAC User Management Section (Admin Only) */}
      {isAdmin ? (
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="h-4.5 w-4.5 text-emerald-400" />
                مدیریت کاربران و سطوح دسترسی مشترک (RBAC)
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                نقش‌های سازمانی دلخواه خود را با سطوح دسترسی پیش‌فرض تعریف کنید و کاربران را به هر نقش متصل نمایید.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={openCreateRoleModal}
                className="bg-zinc-800 hover:bg-zinc-750 text-amber-300 border border-amber-700/40 text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <KeyRound className="h-4 w-4" /> تعریف نقش کاربری جدید
              </button>
              <button
                type="button"
                onClick={openCreateUserModal}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Plus className="h-4 w-4" /> افزودن کاربر جدید
              </button>
            </div>
          </div>

          {/* Defined Roles Strip */}
          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-amber-400" />
                نقش‌های کاربری تعریف‌شده ({toPersianDigits(rolesList.length)} نقش)
              </span>
              <span className="text-[10.5px] text-zinc-500">
                با ویرایش هر نقش می‌توانید دسترسی پیش‌فرض ماژول‌های آن را تغییر دهید
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {rolesList.map((role) => {
                const full = isFullAccessRole(role);
                const permCount = normalizePermissions(role.permissions).filter((p) => p !== '*').length;
                const assignedUsers = userCountByRole.get(role.name) || 0;
                return (
                  <div
                    key={role.id}
                    className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">{role.name}</span>
                        {role.isSystem && (
                          <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/50">
                            سیستمی
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-400 font-mono">
                          ({toPersianDigits(assignedUsers)} کاربر)
                        </span>
                      </div>
                      <div className="text-[10.5px] text-zinc-400">
                        {full ? (
                          <span className="text-emerald-400 font-semibold">دسترسی کامل به کل سامانه</span>
                        ) : permCount === 0 ? (
                          <span className="text-rose-400">بدون بخش مجاز پیش‌فرض</span>
                        ) : (
                          <span>دسترسی به {toPersianDigits(permCount)} ماژول پیش‌فرض</span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-[10px] text-zinc-500 line-clamp-1">{role.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditRoleModal(role)}
                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-amber-300 rounded-lg cursor-pointer transition-colors"
                        title="ویرایش نقش و دسترسی‌های پیش‌فرض"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      {!role.isSystem && role.name !== 'مدیر ارشد' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRole(role)}
                          className="p-1.5 bg-zinc-800 hover:bg-rose-950 text-rose-400 rounded-lg cursor-pointer transition-colors"
                          title="حذف نقش کاربری"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 text-[11px]">
                  <th className="py-2.5 px-3">نام کاربری</th>
                  <th className="py-2.5 px-3">نام و نام خانوادگی</th>
                  <th className="py-2.5 px-3">نقش سازمانی</th>
                  <th className="py-2.5 px-3">شعبه‌های مجاز</th>
                  <th className="py-2.5 px-3">دسترسی بخش‌ها</th>
                  <th className="py-2.5 px-3">وضعیت</th>
                  <th className="py-2.5 px-3 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {usersList.map((u: any) => {
                  const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
                  const hasAll = u.role === 'مدیر ارشد' || perms.includes('*');
                  const allowedBr = normalizeAllowedBranches(u.allowedBranches);
                  const allBranchesAllowed = u.role === 'مدیر ارشد' || allowedBr.includes('*');
                  return (
                    <tr key={u.id || u.username} className="hover:bg-zinc-850/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-zinc-200">{u.username}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{u.fullName || u.name}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${
                          hasAll
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                            : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-zinc-300">
                        {allBranchesAllowed ? (
                          <span className="text-emerald-400 font-semibold">همه شعبه‌ها</span>
                        ) : (
                          <span>
                            {allowedBr
                              .map((bid) => branchList.find((b) => b.id === bid)?.name || bid)
                              .join('، ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-zinc-400">
                        {hasAll ? (
                          <span className="text-emerald-400 font-bold">دسترسی کامل به کل سامانه</span>
                        ) : perms.length === 0 ? (
                          <span className="text-rose-400">بدون دسترسی</span>
                        ) : (
                          <span>
                            {perms
                              .map((p) => SYSTEM_TABS.find((t) => t.id === (p === 'orders' ? 'procurement' : p))?.label || p)
                              .join('، ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {u.isActive !== false ? (
                          <span className="text-emerald-400 text-[11px] font-bold">فعال</span>
                        ) : (
                          <span className="text-rose-400 text-[11px] font-bold">غیرفعال</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditUserModal(u)}
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-sky-400 rounded-lg cursor-pointer transition-colors"
                            title="ویرایش کاربر و سطح دسترسی"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {u.username !== currentUser.username && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 bg-zinc-800 hover:bg-rose-950 text-rose-400 rounded-lg cursor-pointer transition-colors"
                              title="حذف کاربر"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center gap-3 text-xs text-zinc-400">
          <Lock className="h-4 w-4 text-amber-400 shrink-0" />
          <span>مدیریت کاربران، انتقال کل دیتابیس و مشاهده گزارش وقایع فقط در سطح دسترسی <strong className="text-zinc-200">مدیر ارشد</strong> فعال است.</span>
        </div>
      )}

      {/* Audit Logs Viewer (when PostgreSQL connected & Admin) */}
      {isPgConnected && isAdmin && (
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-sky-400" />
              گزارش آخرین تغییرات و فعالیت کاربران (Audit Log)
            </h3>
            <button
              type="button"
              onClick={loadPgAdminData}
              className="text-[11px] text-sky-400 hover:text-sky-300 font-bold cursor-pointer"
            >
              بروزرسانی لیست
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-xs text-zinc-500">هنوز رویدادی در PostgreSQL ثبت نشده است.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto border border-zinc-850 rounded-xl">
              <table className="w-full text-[11px] text-right">
                <thead className="bg-zinc-950 text-zinc-400 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">کاربر</th>
                    <th className="py-2 px-3">عملیات</th>
                    <th className="py-2 px-3">بخش / جدول</th>
                    <th className="py-2 px-3">تعداد رکورد</th>
                    <th className="py-2 px-3">زمان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-850/30">
                      <td className="py-1.5 px-3 font-mono font-bold text-emerald-400">{log.username}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-200">{log.action}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-400">{log.collectionKey || '-'}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-300">
                        {log.recordCount !== null ? toPersianDigits(log.recordCount) : '-'}
                      </td>
                      <td className="py-1.5 px-3 text-zinc-400 font-mono" dir="ltr">
                        {new Date(log.createdAt).toLocaleString('fa-IR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Legacy SQL Server / Google Sheets Panel */}
      <div className="border border-zinc-800 rounded-2xl bg-zinc-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLegacySql((prev) => !prev)}
          className="w-full p-4 flex items-center justify-between text-xs font-bold text-zinc-300 hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-400" />
            تنظیمات جانبی همگام‌سازی (SQL Server فروشگاه محلی و Google Sheets)
          </span>
          {showLegacySql ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showLegacySql && (
          <div className="p-5 border-t border-zinc-800 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  آدرس سرور فروشگاه (SQL Server REST API URL):
                </label>
                <input
                  type="text"
                  value={sqlServerUrl}
                  onChange={(e) => setSqlServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:5000/api"
                  className="w-full bg-zinc-950 text-zinc-100 border border-zinc-800 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs font-mono outline-none"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  کلید دسترسی API Key (اختیاری):
                </label>
                <input
                  type="password"
                  value={sqlServerApiKey}
                  onChange={(e) => setSqlServerApiKey(e.target.value)}
                  className="w-full bg-zinc-950 text-zinc-100 border border-zinc-800 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs font-mono outline-none"
                  dir="ltr"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sql-auto-sync-check"
                  checked={sqlServerAutoSync}
                  onChange={(e) => {
                    setSqlServerAutoSync(e.target.checked);
                    onUpdateDb({
                      ...db,
                      sqlServerConfig: { ...db.sqlServerConfig, autoSync: e.target.checked },
                    });
                  }}
                  className="rounded border-zinc-700 text-blue-600 h-4 w-4 bg-zinc-950 cursor-pointer"
                />
                <label htmlFor="sql-auto-sync-check" className="text-xs text-zinc-300 cursor-pointer font-bold">
                  همگام‌سازی خودکار با SQL Server فروشگاه
                </label>
              </div>
              {sqlServerStatusMessage && (
                <div className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  sqlServerStatusMessage.type === 'success'
                    ? 'bg-emerald-950/30 text-emerald-300'
                    : sqlServerStatusMessage.type === 'error'
                    ? 'bg-rose-950/30 text-rose-300'
                    : 'bg-blue-950/30 text-blue-300'
                }`}>
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{sqlServerStatusMessage.text}</span>
                </div>
              )}
              <button
                type="button"
                onClick={onTestSqlServerConnection}
                disabled={isSqlServerTesting}
                className="w-full bg-zinc-800 hover:bg-zinc-750 text-blue-300 border border-zinc-700 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-2"
              >
                <Link className="h-4 w-4" /> تست اتصال SQL Server
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onSaveToSqlServer}
                  disabled={isSqlServerSyncing}
                  className="bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Upload className="h-4 w-4" /> ارسال (Push)
                </button>
                <button
                  type="button"
                  onClick={onRestoreFromSqlServer}
                  disabled={isSqlServerSyncing}
                  className="bg-zinc-800 hover:bg-zinc-750 text-amber-300 border border-zinc-700 py-2.5 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Download className="h-4 w-4" /> دریافت (Pull)
                </button>
              </div>
              <button
                type="button"
                onClick={onDownloadSqlServerScript}
                className="w-full bg-zinc-950 hover:bg-zinc-850 text-emerald-400 border border-zinc-800 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-2"
              >
                <Download className="h-4 w-4" /> دانلود اسکریپت T-SQL (SSMS)
              </button>
              <div>
                <label className="block text-[10.5px] font-semibold text-zinc-400 mb-1">
                  آدرس وب‌هوک گوگل شیت (اختیاری):
                </label>
                <input
                  type="text"
                  value={db.googleSheetsUrl || ''}
                  onChange={(e) => onUpdateDb({ ...db, googleSheetsUrl: e.target.value })}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full bg-zinc-950 text-zinc-200 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono outline-none"
                  dir="ltr"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Shield className="h-4.5 w-4.5 text-emerald-400" />
                {editingUser ? `ویرایش کاربر: ${editingUser.username}` : 'تعریف کاربر جدید'}
              </h3>
              <button
                type="button"
                onClick={() => setIsUserModalOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">نام کاربری (انگلیسی)</label>
                  <input
                    type="text"
                    required
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">نام و نام خانوادگی</label>
                  <input
                    type="text"
                    required
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-zinc-400">نقش کاربر</label>
                    <button
                      type="button"
                      onClick={() => setFormPermissions(getPresetForRole(formRole))}
                      className="text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer"
                    >
                      اعمال دسترسی پیش‌فرض نقش
                    </button>
                  </div>
                  <select
                    value={formRole}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  >
                    {rolesList.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}{isFullAccessRole(r) ? ' (دسترسی کامل)' : ''}
                      </option>
                    ))}
                    {!rolesList.some((r) => r.name === formRole) && formRole && (
                      <option value={formRole}>{formRole}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                    {editingUser ? 'رمز عبور جدید (خالی = بدون تغییر)' : 'رمز عبور'}
                  </label>
                  <input
                    type="password"
                    required={!editingUser}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={editingUser ? 'در صورت تغییر وارد کنید...' : 'رمز عبور'}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  حساب فعال است
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={formIs2FA}
                    onChange={(e) => setFormIs2FA(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  تایید دو مرحله‌ای (2FA)
                </label>
                {formIs2FA && (
                  <input
                    type="text"
                    maxLength={6}
                    value={formSecretCode}
                    onChange={(e) => setFormSecretCode(e.target.value)}
                    placeholder="کد ۶ رقمی"
                    className="w-28 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs font-mono text-center text-white"
                    dir="ltr"
                  />
                )}
              </div>

              {/* Allowed Branches Selector */}
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-zinc-300">
                    شعبه‌های مجاز برای ورود و ثبت اطلاعات:
                  </label>
                  {formRole !== 'مدیر ارشد' && (
                    <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formAllowedBranches.includes('*')}
                        onChange={() => toggleAllowedBranch('*')}
                        className="rounded border-zinc-700 bg-zinc-950 text-emerald-500"
                      />
                      دسترسی به همه شعبه‌ها (*)
                    </label>
                  )}
                </div>
                {formRole === 'مدیر ارشد' || formAllowedBranches.includes('*') ? (
                  <div className="p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-800/40 text-[11px] text-emerald-300">
                    این کاربر به تمامی شعبه‌های فعال سامانه دسترسی دارد.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 bg-zinc-900/60 rounded-xl border border-zinc-800">
                    {(branchList.length > 0 ? branchList : DEFAULT_BRANCHES).map((b) => {
                      const checked = formAllowedBranches.includes(b.id);
                      return (
                        <label key={b.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAllowedBranch(b.id)}
                            className="rounded border-zinc-700 bg-zinc-950 text-emerald-500"
                          />
                          <span className="truncate">{b.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {formRole !== 'مدیر ارشد' && (
                <div className="space-y-2 border-t border-zinc-800 pt-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-bold text-zinc-300">
                      بخش‌های مجاز برای مشاهده و ویرایش:
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-emerald-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formPermissions.includes('*')}
                        onChange={() => togglePermission('*')}
                        className="rounded border-zinc-700 bg-zinc-950 text-emerald-500"
                      />
                      دسترسی کامل (*)
                    </label>
                  </div>
                  {formPermissions.includes('*') ? (
                    <div className="p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-800/40 text-[11px] text-emerald-300">
                      این کاربر دارای دسترسی کامل به تمامی ماژول‌های سامانه است.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-zinc-900/60 rounded-xl border border-zinc-800">
                      {SYSTEM_TABS.filter((t) => t.id !== 'cloud_sync').map((tab) => {
                        const checked = formPermissions.includes(tab.id);
                        return (
                          <label key={tab.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(tab.id)}
                              className="rounded border-zinc-700 bg-zinc-950 text-emerald-500"
                            />
                            <span>{tab.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {userFormError && (
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
                  {userFormError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                >
                  {editingUser ? 'ذخیره تغییرات کاربر' : 'ایجاد کاربر'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-zinc-800"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Role Definition Modal */}
      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <KeyRound className="h-4.5 w-4.5 text-amber-400" />
                {editingRole ? `ویرایش نقش کاربری: ${editingRole.name}` : 'تعریف نقش کاربری جدید'}
              </h3>
              <button
                type="button"
                onClick={() => setIsRoleModalOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                  نام نقش کاربری (مثال: مدیر فروش، مسئول تولید، صندوقدار)
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingRole?.isSystem || editingRole?.name === 'مدیر ارشد')}
                  value={roleNameInput}
                  onChange={(e) => setRoleNameInput(e.target.value)}
                  placeholder="نام نقش را وارد کنید..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 mb-1">توضیحات نقش (اختیاری)</label>
                <input
                  type="text"
                  value={roleDescInput}
                  onChange={(e) => setRoleDescInput(e.target.value)}
                  placeholder="شرح مختصر مسئولیت‌های این نقش..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <label className="flex items-center gap-2 text-xs font-bold text-emerald-400 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={Boolean(editingRole?.isSystem || editingRole?.name === 'مدیر ارشد')}
                    checked={roleFullAccessInput}
                    onChange={(e) => setRoleFullAccessInput(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  دسترسی کامل مدیر ارشد به تمامی ماژول‌ها و تنظیمات سیستم (*)
                </label>

                {!roleFullAccessInput && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-bold text-zinc-300">
                        ماژول‌های مجاز پیش‌فرض برای این نقش:
                      </label>
                      <div className="flex gap-3 text-[10.5px]">
                        <button
                          type="button"
                          onClick={() => setRolePermsInput(SYSTEM_TABS.filter((t) => t.id !== 'cloud_sync').map((t) => t.id))}
                          className="text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        >
                          انتخاب همه
                        </button>
                        <button
                          type="button"
                          onClick={() => setRolePermsInput([])}
                          className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        >
                          پاک کردن
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2.5 bg-zinc-900/60 rounded-xl border border-zinc-800">
                      {SYSTEM_TABS.filter((t) => t.id !== 'cloud_sync').map((tab) => {
                        const checked = rolePermsInput.includes(tab.id);
                        return (
                          <label key={tab.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRolePermission(tab.id)}
                              className="rounded border-zinc-700 bg-zinc-950 text-amber-500"
                            />
                            <span>{tab.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {editingRole && (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={applyRolePermsToUsers}
                    onChange={(e) => setApplyRolePermsToUsers(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-amber-500"
                  />
                  بروزرسانی دسترسی کاربران فعلی دارای این نقش مطابق تنظیمات جدید
                </label>
              )}

              {roleFormError && (
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
                  {roleFormError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                >
                  {editingRole ? 'ذخیره تغییرات نقش' : 'ثبت نقش جدید'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsRoleModalOpen(false)}
                  className="px-4 py-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-zinc-800"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Branch Modal */}
      {isBranchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Building2 className="h-4.5 w-4.5 text-emerald-400" />
                {editingBranch ? `ویرایش شعبه: ${editingBranch.name}` : 'تعریف شعبه جدید با دیتابیس مجزا'}
              </h3>
              <button
                type="button"
                onClick={() => setIsBranchModalOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBranch} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                  نام شعبه (مثال: شعبه سوم - ولنجک)
                </label>
                <input
                  type="text"
                  required
                  value={branchNameInput}
                  onChange={(e) => setBranchNameInput(e.target.value)}
                  placeholder="نام شعبه را وارد کنید..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                />
              </div>

              {!editingBranch && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                      شناسه آدرس منوی QR (اختیاری - انگلیسی)
                    </label>
                    <input
                      type="text"
                      value={branchSlugInput}
                      onChange={(e) => setBranchSlugInput(e.target.value)}
                      placeholder="خودکار (مثل branch-3)"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                      نام دیتابیس PostgreSQL (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={branchDbNameInput}
                      onChange={(e) => setBranchDbNameInput(e.target.value)}
                      placeholder="خودکار (مثل gatan_branch_3)"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">تلفن شعبه (اختیاری)</label>
                  <input
                    type="text"
                    value={branchPhoneInput}
                    onChange={(e) => setBranchPhoneInput(e.target.value)}
                    placeholder="۰۲۱-..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1">نشانی شعبه (اختیاری)</label>
                  <input
                    type="text"
                    value={branchAddressInput}
                    onChange={(e) => setBranchAddressInput(e.target.value)}
                    placeholder="آدرس کوتاه شعبه..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {editingBranch && !editingBranch.isDefault && (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={branchIsActiveInput}
                    onChange={(e) => setBranchIsActiveInput(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  این شعبه فعال و قابل انتخاب برای کاربران است
                </label>
              )}

              {!editingBranch && (
                <div className="p-3 rounded-xl bg-emerald-950/25 border border-emerald-800/40 text-[11px] text-emerald-300 leading-5">
                  دیتابیس شعبه جدید به‌صورت کاملاً مجزا و خالی ایجاد می‌شود. پس از ساخت، می‌توانید با ابزار «کپی اطلاعات از شعبه دیگر» تعاریف پایه (کالاها، فرمول‌ها و دسته‌بندی‌ها) را به آن منتقل کنید.
                </div>
              )}

              {branchFormError && (
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
                  {branchFormError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-60"
                >
                  {isBusy ? 'در حال ایجاد...' : editingBranch ? 'ذخیره تغییرات شعبه' : 'ایجاد شعبه و دیتابیس'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsBranchModalOpen(false)}
                  className="px-4 py-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-zinc-800"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
