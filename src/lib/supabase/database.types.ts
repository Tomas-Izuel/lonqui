
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "app_users": {
                  Row: {
                    "created_at": string,"created_by": string | null,"display_name": string,"email": string,"is_active": boolean,"must_change_password": boolean,"password_changed_at": string | null,"password_reset_at": string | null,"role": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"display_name": string,"email": string,"is_active"?: boolean,"must_change_password"?: boolean,"password_changed_at"?: string | null,"password_reset_at"?: string | null,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"display_name"?: string,"email"?: string,"is_active"?: boolean,"must_change_password"?: boolean,"password_changed_at"?: string | null,"password_reset_at"?: string | null,"role"?: string,"updated_at"?: string,"user_id"?: string
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
                },"billing_runs": {
                  Row: {
                    "actor_id": string | null,"error_message": string | null,"fees_created": number,"finished_at": string | null,"id": number,"notified_at": string | null,"period": string,"started_at": string,"status": string,"trigger": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"error_message"?: string | null,"fees_created"?: number,"finished_at"?: string | null,"id"?: never,"notified_at"?: string | null,"period": string,"started_at"?: string,"status": string,"trigger": string
                  }
                  Update: {
                    "actor_id"?: string | null,"error_message"?: string | null,"fees_created"?: number,"finished_at"?: string | null,"id"?: never,"notified_at"?: string | null,"period"?: string,"started_at"?: string,"status"?: string,"trigger"?: string
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
                },"fee_prices": {
                  Row: {
                    "amount_cents": number,"category_id": number | null,"created_at": string,"created_by": string | null,"id": number,"member_type": string | null,"notes": string | null,"scope": string,"valid_from": string
                  }
                  Insert: {
                    "amount_cents": number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_type"?: string | null,"notes"?: string | null,"scope": string,"valid_from": string
                  }
                  Update: {
                    "amount_cents"?: number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_type"?: string | null,"notes"?: string | null,"scope"?: string,"valid_from"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_prices_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"fees": {
                  Row: {
                    "amount_cents": number,"category_id": number | null,"created_at": string,"created_by": string | null,"description": string | null,"discipline_id": number | null,"fee_price_id": number | null,"id": number,"kind": string,"member_id": number,"period": string,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"discipline_id"?: number | null,"fee_price_id"?: number | null,"id"?: never,"kind": string,"member_id": number,"period": string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"discipline_id"?: number | null,"fee_price_id"?: number | null,"id"?: never,"kind"?: string,"member_id"?: number,"period"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fees_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_fee_price_id_fkey"
      columns: ["fee_price_id"]
isOneToOne: false
      referencedRelation: "fee_prices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
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
                },"member_categories": {
                  Row: {
                    "category_id": number,"created_at": string,"created_by": string | null,"id": number,"joined_on": string,"left_at": string | null,"left_by": string | null,"left_on": string | null,"left_reason": string | null,"member_id": number
                  }
                  Insert: {
                    "category_id": number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"joined_on": string,"left_at"?: string | null,"left_by"?: string | null,"left_on"?: string | null,"left_reason"?: string | null,"member_id": number
                  }
                  Update: {
                    "category_id"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"joined_on"?: string,"left_at"?: string | null,"left_by"?: string | null,"left_on"?: string | null,"left_reason"?: string | null,"member_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_categories_member_id_fkey"
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
                    "address": string | null,"birth_date": string | null,"created_at": string,"created_by": string | null,"dni": string | null,"email": string | null,"family_group_id": number | null,"first_name": string,"id": number,"is_payment_responsible": boolean,"joined_on": string,"last_name": string,"member_type": string,"notes": string | null,"phone": string | null,"search_text": string | null,"status": string,"status_changed_on": string | null,"updated_at": string,"member_balance_cents": number | null,"member_debt_status": string | null,"member_months_due": number | null
                  }
                  Insert: {
                    "address"?: string | null,"birth_date"?: string | null,"created_at"?: string,"created_by"?: string | null,"dni"?: string | null,"email"?: string | null,"family_group_id"?: number | null,"first_name": string,"id"?: never,"is_payment_responsible"?: boolean,"joined_on": string,"last_name": string,"member_type"?: string,"notes"?: string | null,"phone"?: string | null,"search_text"?: never,"status"?: string,"status_changed_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"birth_date"?: string | null,"created_at"?: string,"created_by"?: string | null,"dni"?: string | null,"email"?: string | null,"family_group_id"?: number | null,"first_name"?: string,"id"?: never,"is_payment_responsible"?: boolean,"joined_on"?: string,"last_name"?: string,"member_type"?: string,"notes"?: string | null,"phone"?: string | null,"search_text"?: never,"status"?: string,"status_changed_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_family_group_id_fkey"
      columns: ["family_group_id"]
isOneToOne: false
      referencedRelation: "family_groups"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"batch_id": string,"created_at": string,"created_by": string | null,"id": number,"member_id": number,"method": string,"notes": string | null,"paid_on": string,"receipt_filename": string | null,"receipt_storage_path": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"batch_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_id": number,"method": string,"notes"?: string | null,"paid_on"?: string,"receipt_filename"?: string | null,"receipt_storage_path"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"batch_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_id"?: number,"method"?: string,"notes"?: string | null,"paid_on"?: string,"receipt_filename"?: string | null,"receipt_storage_path"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
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
"daily_collection":
{ Args: { "target_period"?: string }; Returns: {
              "collected_cents": number,"cumulative_cents": number,"day": string
            }[]
                           },
"dashboard_summary":
{ Args: Record<PropertyKey, never>; Returns: {
              "active_members": number,"admissions_count": number,"billing_active": boolean,"billing_start_period": string,"cash_cents": number,"collected_cents": number,"credit_cents": number,"expired_clearances": number,"fees_cents": number,"fees_count": number,"inactive_debt_cents": number,"inactive_in_debt": number,"members_in_debt": number,"members_with_credit": number,"missing_clearances": number,"payments_count": number,"pending_periods": (string)[],"period": string,"reactivations_count": number,"total_debt_cents": number,"transfer_cents": number,"withdrawals_count": number
            }[]
                           },
"debt_by_category":
{ Args: Record<PropertyKey, never>; Returns: {
              "category_id": number,"category_name": string,"debt_cents": number,"discipline_id": number,"discipline_name": string,"kind": string,"members": number,"members_in_debt": number,"sort_order": number
            }[]
                           },
"generate_pending_fees":
{ Args: Record<PropertyKey, never>; Returns: {
              "error_message": string,"fees_created": number,"status": string
            }[]
                           },
"log_export":
{ Args: { "filters": Json,"listing": string,"row_count": number }; Returns: undefined
                           },
"mark_password_reset":
{ Args: { "target_user_id": string }; Returns: undefined
                           },
"member_accounts":
{ Args: { "category_filter"?: number,"member_ids"?: (number)[],"status_filter"?: string }; Returns: {
              "balance_cents": number,"categories": Json,"charged_cents": number,"current_fee_cents": number,"current_fee_period": string,"current_fees": Json,"debt_status": string,"family_group_id": number,"full_name": string,"is_payment_responsible": boolean,"last_payment_cents": number,"last_payment_on": string,"member_id": number,"member_type": string,"months_due": number,"oldest_due_period": string,"paid_cents": number,"status": string
            }[]
                           },
"member_balance_cents":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'] }; Returns: number
                           },
"member_debt_status":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'] }; Returns: string
                           },
"member_fee_statement":
{ Args: { "target_member_id": number }; Returns: {
              "amount_cents": number,"category_id": number,"covered_cents": number,"description": string,"discipline_id": number,"fee_id": number,"kind": string,"period": string,"status": string,"void_reason": string,"voided_at": string
            }[]
                           },
"member_months_due":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'] }; Returns: number
                           },
"month_collection":
{ Args: { "target_period"?: string }; Returns: {
              "cash_cents": number,"collected_cents": number,"fees_cents": number,"fees_count": number,"payments_count": number,"period": string,"transfer_cents": number
            }[]
                           },
"monthly_history":
{ Args: { "months"?: number }; Returns: {
              "collected_cents": number,"debt_at_close_cents": number,"fees_cents": number,"period": string
            }[]
                           },
"my_permissions":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"set_family_payment_responsible":
{ Args: { "group_id": number,"member_id": number }; Returns: undefined
                           },
"set_member_categories":
{ Args: { "category_ids": (number)[],"effective_on"?: string,"target_member_id": number }; Returns: undefined
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

