export interface UserOrgDTO {
    orgId: number;
    name: string;
    role: OrgRole;
}
export declare enum OrgRole {
    None = "None",
    Viewer = "Viewer",
    Editor = "Editor",
    Admin = "Admin"
}
