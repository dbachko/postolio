// Kitchen sink page for manual UI verification
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function UiKitchenSink() {
  return (
    <div className="mx-auto w-full space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Buttons & Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="grid max-w-md gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="John Doe" />
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" rows={3} placeholder="Short bio..." />
          </div>
          <div className="flex items-center gap-4">
            <Checkbox id="terms" />
            <Label htmlFor="terms">Accept terms</Label>
            <Switch />
          </div>
          <div className="max-w-sm">
            <Label>Favorite</Label>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Option A</SelectItem>
                <SelectItem value="b">Option B</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tabs, Tooltip & Dialog</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="one" className="max-w-lg">
            <TabsList>
              <TabsTrigger value="one">One</TabsTrigger>
              <TabsTrigger value="two">Two</TabsTrigger>
            </TabsList>
            <TabsContent value="one">Tab One Content</TabsContent>
            <TabsContent value="two">Tab Two Content</TabsContent>
          </Tabs>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover me</Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip content</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog Title</DialogTitle>
              </DialogHeader>
              <div>Dialog content area</div>
            </DialogContent>
          </Dialog>
          <Alert>
            <AlertDescription>Informational alert</AlertDescription>
          </Alert>
          <Separator />
          <RadioGroup defaultValue="1" className="flex gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="r1" value="1" />
              <Label htmlFor="r1">One</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="r2" value="2" />
              <Label htmlFor="r2">Two</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
