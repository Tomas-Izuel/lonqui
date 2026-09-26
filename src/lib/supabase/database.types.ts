
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "app_users": {
                  Row: {
                    "created_at": string,"created_by": string | null,"display_name": string,"email": string,"is_active": boolean,"must_change_password": boolean,"password_changed_at": string | null,"role": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"display_name": string,"email": string,"is_active"?: boolean,"must_change_password"?: boolean,"password_changed_at"?: string | null,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"display_name"?: string,"email"?: string,"is_active"?: boolean,"must_change_password"?: boolean,"password_changed_at"?: string | null,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "actor_id": string | null,"actor_source": string,"changed_fields": (string)[] | null,"context": Json | null,"id": number,"new_data": Json | null,"occurred_at": string,"old_data": Json | null,"op": string,"record_id": string | null,"table_name": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"actor_source": string,"changed_fields"?: (string)[] | null,"context"?: Json | null,"id"?: never,"new_data"?: Json | null,"occurred_at"?: string,"old_data"?: Json | null,"op": string,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_source"?: string,"changed_fields"?: (string)[] | null,"context"?: Json | null,"id"?: never,"new_data"?: Json | null,"occurred_at"?: string,"old_data"?: Json | null,"op"?: string,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"discipline_id": number,"id": number,"is_active": boolean,"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"discipline_id": number,"id"?: never,"is_active"?: boolean,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"discipline_id"?: number,"id"?: never,"is_active"?: boolean,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    }
                  ]
                },"disciplines": {
                  Row: {
                    "created_at": string,"id": number,"is_active": boolean,"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: never,"is_active"?: boolean,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"is_active"?: boolean,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"family_groups": {
                  Row: {
                    "created_at": string,"id": number,"name": string | null,"notes": string | null,"payer_contact_name": string | null,"payer_contact_phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: never,"name"?: string | null,"notes"?: string | null,"payer_contact_name"?: string | null,"payer_contact_phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"name"?: string | null,"notes"?: string | null,"payer_contact_name"?: string | null,"payer_contact_phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"medical_clearances": {
                  Row: {
                    "created_at": string,"expires_on": string,"id": number,"member_id": number,"notes": string | null,"original_filename": string | null,"storage_path": string | null,"updated_at": string,"uploaded_by": string | null
                  }
                  Insert: {
                    "created_at"?: string,"expires_on": string,"id"?: never,"member_id": number,"notes"?: string | null,"original_filename"?: string | null,"storage_path"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_on"?: string,"id"?: never,"member_id"?: number,"notes"?: string | null,"original_filename"?: string | null,"storage_path"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "medical_clearances_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"member_status_events": {
                  Row: {
                    "created_at": string,"created_by": string | null,"effective_on": string,"event_type": string,"id": number,"member_id": number,"notes": string | null,"reason": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"effective_on": string,"event_type": string,"id"?: never,"member_id": number,"notes"?: string | null,"reason": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"effective_on"?: string,"event_type"?: string,"id"?: never,"member_id"?: number,"notes"?: string | null,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_status_events_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"members": {
                  Row: {
                    "address": string | null,"birth_date": string | null,"category_id": number | null,"created_at": string,"created_by": string | null,"dni": string | null,"email": string | null,"family_group_id": number | null,"first_name": string,"id": number,"is_payment_responsible": boolean,"joined_on": string,"last_name": string,"member_type": string,"notes": string | null,"phone": string | null,"search_text": string | null,"status": string,"status_changed_on": string | null,"updated_at": string
                  }
                  Insert: {
                    "address"?: string | null,"birth_date"?: string | null,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"dni"?: string | null,"email"?: string | null,"family_group_id"?: number | null,"first_name": string,"id"?: never,"is_payment_responsible"?: boolean,"joined_on": string,"last_name": string,"member_type": string,"notes"?: string | null,"phone"?: string | null,"search_text"?: never,"status"?: string,"status_changed_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"birth_date"?: string | null,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"dni"?: string | null,"email"?: string | null,"family_group_id"?: number | null,"first_name"?: string,"id"?: never,"is_payment_responsible"?: boolean,"joined_on"?: string,"last_name"?: string,"member_type"?: string,"notes"?: string | null,"phone"?: string | null,"search_text"?: never,"status"?: string,"status_changed_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "members_family_group_id_fkey"
      columns: ["family_group_id"]
isOneToOne: false
      referencedRelation: "family_groups"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "billing_start_period": string | null,"club_name": string,"id": number,"updated_at": string
                  }
                  Insert: {
                    "billing_start_period"?: string | null,"club_name"?: string,"id"?: number,"updated_at"?: string
                  }
                  Update: {
                    "billing_start_period"?: string | null,"club_name"?: string,"id"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "confirm_password_changed":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mark_password_reset":
{ Args: { "target_user_id": string }; Returns: undefined
                           },
"set_family_payment_responsible":
{ Args: { "group_id": number,"member_id": number }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

